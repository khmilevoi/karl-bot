# Behavior Context + Ordinal Remap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Carl leaking internal message-store IDs into visible replies and make him understand which message a user refers to, by remapping message references to per-call ordinals, persisting the bot's own replies, and restoring reply/quote linkage in the behavior prompt.

**Architecture:** A new `MessageReferenceMap` value object assigns per-AI-call ordinals (`#1..#N`) to messages. `PromptBuilder.addBehaviorMessages` renders `[#N]` instead of `[storeId]`/`[telegramId]` and re-adds reply/quote sub-lines. `ChatGPTService` (the single `BehaviorAiService` implementation) owns the map per call and translates the model's emitted ordinals back to real `messages.id` before anything is persisted, so the pipeline and patch applicator keep working with real store IDs unchanged. The bot's replies are persisted as `role:assistant` rows so they re-enter context.

**Tech Stack:** TypeScript, Inversify DI, grammy (Telegram), OpenAI SDK + Zod v4 schemas, Vitest, SQLite.

---

## Background (read before starting)

Spec: `docs/superpowers/specs/2026-06-01-behavior-context-ordinal-remap-design.md`.

Four root causes, all fixed here:
- **A** internal `storeId` leaks into `action.text` (e.g. «ст. 150 и 154–161»);
- **B** bot replies are never persisted (`MessageFactory.fromAssistant` is dead code), so Carl is blind to his own turns;
- **C** reply/quote linkage is dropped in the behavior message format;
- **D** two numeric id namespaces inline (`storeId` + `telegramId`) cause id-space confusion.

Key invariants confirmed during design:
- Reply/react targeting uses `scope`+`pick`+`index` selectors, NOT raw ids — remap does not affect targeting.
- The ONLY response fields carrying message references are: gate `triggerMessageIds`/`contextMessageIds`; `statePatches[].evidence.messageIds`; `evolutionPatches[].evidence.messageIds`.
- `userId` in patches and `userSnapshots[].userId`/`userPoliticalSnapshots[].userId` are **Telegram user ids**, NOT message references — keep them, never remap them.
- `evidence.messageIds` is persisted directly into the DB as real `messages.id`, so translation MUST happen before persistence.

Conventions:
- Tests live in `test/*.test.ts`, use Vitest (`import { describe, it, expect, vi } from 'vitest'`), and instantiate classes directly with hand-rolled mocks (no DI container in tests).
- Run a single test file: `pnpm test -- test/<file>.test.ts`.
- Before each commit: `pnpm format:fix && pnpm lint:fix && pnpm type:check && pnpm test`.
- Project rules: no `any`, no `@ts-` directives, no default exports, use `null` not `undefined` in your own type declarations, prefer pattern-matching/`switch` over ternaries.
- Commits of source code are expected. Do NOT `git add` anything under `docs/superpowers/` (gitignored working artifacts).

---

## File Structure

- `src/application/prompts/MessageReferenceMap.ts` — NEW. Value object: storeId↔ordinal mapping + ordinal→storeId translation.
- `src/application/behavior/OrdinalTranslation.ts` — NEW. Pure functions translating gate/live/evolution response ids from ordinals to store ids.
- `src/application/prompts/PromptBuilder.ts` — MODIFY `addBehaviorMessages` (render `[#N]`, drop storeId/telegramId, add reply/quote).
- `src/application/prompts/PromptDirector.ts` — MODIFY 3 behavior prompt methods to thread the ref map.
- `src/infrastructure/external/ChatGPTService.ts` — MODIFY 3 lanes to build the map and translate responses.
- `src/application/interfaces/chat/ChatMessenger.ts` — MODIFY `sendMessage` return type.
- `src/view/telegram/TelegramMessenger.ts` — MODIFY `sendMessage` to return the Telegram message id.
- `src/application/behavior/DefaultBehaviorExecutor.ts` — MODIFY to persist assistant replies.
- `src/application/behavior/DefaultBehaviorDecisionValidator.ts` — MODIFY: strip leaked rendered tags from visible text.
- `prompts/behavior_gate_system_prompt.md`, `prompts/behavior_decision_system_prompt.md`, `prompts/state_evolution_system_prompt.md` — MODIFY wording (reference numbers, no-leak instruction).
- Tests: `test/MessageReferenceMap.test.ts`, `test/OrdinalTranslation.test.ts`, `test/PromptBuilderBehaviorMessages.test.ts`, `test/DefaultBehaviorExecutor.test.ts`, `test/DefaultBehaviorDecisionValidator.test.ts` (all NEW).

---

## Task 1: `MessageReferenceMap` value object

**Files:**
- Create: `src/application/prompts/MessageReferenceMap.ts`
- Test: `test/MessageReferenceMap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/MessageReferenceMap.test.ts
import { describe, expect, it } from 'vitest';

import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';

describe('MessageReferenceMap', () => {
  it('assigns 1-based ordinals in ascending storeId order', () => {
    const map = MessageReferenceMap.fromMessages([{ id: 161 }, { id: 150 }, { id: 154 }]);
    expect(map.ordinalFor(150)).toBe(1);
    expect(map.ordinalFor(154)).toBe(2);
    expect(map.ordinalFor(161)).toBe(3);
  });

  it('round-trips ordinal <-> storeId', () => {
    const map = MessageReferenceMap.fromMessages([{ id: 150 }, { id: 161 }]);
    expect(map.storeIdFor(1)).toBe(150);
    expect(map.storeIdFor(2)).toBe(161);
  });

  it('returns null for unknown storeId or out-of-range ordinal', () => {
    const map = MessageReferenceMap.fromMessages([{ id: 150 }]);
    expect(map.ordinalFor(999)).toBeNull();
    expect(map.storeIdFor(0)).toBeNull();
    expect(map.storeIdFor(2)).toBeNull();
  });

  it('translate() maps ordinals to storeIds and drops unresolved ones', () => {
    const map = MessageReferenceMap.fromMessages([{ id: 150 }, { id: 161 }]);
    expect(map.translate([1, 2, 99])).toEqual([150, 161]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/MessageReferenceMap.test.ts`
Expected: FAIL — cannot find module `MessageReferenceMap`.

- [ ] **Step 3: Write the implementation**

```ts
// src/application/prompts/MessageReferenceMap.ts

/**
 * Per-AI-call mapping between the bot's real message store id (messages.id) and a
 * compact 1-based ordinal reference (#1..#N) shown to the model. The model never
 * sees real store ids; it emits ordinals, which are translated back here.
 */
export class MessageReferenceMap {
  private readonly storeIdToOrdinal: Map<number, number>;
  private readonly ordinalToStoreId: Map<number, number>;

  private constructor(orderedStoreIds: readonly number[]) {
    this.storeIdToOrdinal = new Map();
    this.ordinalToStoreId = new Map();
    orderedStoreIds.forEach((storeId, index) => {
      const ordinal = index + 1;
      this.storeIdToOrdinal.set(storeId, ordinal);
      this.ordinalToStoreId.set(ordinal, storeId);
    });
  }

  static fromMessages(
    messages: ReadonlyArray<{ id: number }>
  ): MessageReferenceMap {
    const orderedStoreIds = [...new Set(messages.map((m) => m.id))].sort(
      (a, b) => a - b
    );
    return new MessageReferenceMap(orderedStoreIds);
  }

  ordinalFor(storeId: number): number | null {
    return this.storeIdToOrdinal.get(storeId) ?? null;
  }

  storeIdFor(ordinal: number): number | null {
    return this.ordinalToStoreId.get(ordinal) ?? null;
  }

  /** Map a list of model-emitted ordinals to real store ids, dropping unresolved ones. */
  translate(ordinals: readonly number[]): number[] {
    const result: number[] = [];
    for (const ordinal of ordinals) {
      const storeId = this.storeIdFor(ordinal);
      if (storeId !== null) {
        result.push(storeId);
      }
    }
    return result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/MessageReferenceMap.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
pnpm format:fix && pnpm lint:fix && pnpm type:check
git add src/application/prompts/MessageReferenceMap.ts test/MessageReferenceMap.test.ts
git commit -m "feat(prompts): add MessageReferenceMap ordinal value object"
```

---

## Task 2: Ordinal translation helpers

**Files:**
- Create: `src/application/behavior/OrdinalTranslation.ts`
- Test: `test/OrdinalTranslation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/OrdinalTranslation.test.ts
import { describe, expect, it } from 'vitest';

import {
  translateEvolutionPatches,
  translateGateDecision,
  translateLivePatches,
} from '../src/application/behavior/OrdinalTranslation';
import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';
import type { BehaviorGateDecision } from '../src/domain/behavior/schemas/gate';
import type {
  EvolutionPatch,
  LiveStatePatch,
} from '../src/domain/behavior/schemas/patches';

const map = MessageReferenceMap.fromMessages([{ id: 150 }, { id: 161 }]);

describe('translateGateDecision', () => {
  it('maps trigger/context ordinals to store ids', () => {
    const decision: BehaviorGateDecision = {
      shouldDecide: true,
      confidence: 0.9,
      reason: 'conflict',
      triggerMessageIds: [1],
      contextMessageIds: [2, 99],
      stateImpactRisk: 'low',
    };
    const out = translateGateDecision(decision, map);
    expect(out.triggerMessageIds).toEqual([150]);
    expect(out.contextMessageIds).toEqual([161]);
  });
});

describe('translateLivePatches', () => {
  it('maps evidence.messageIds and leaves other fields intact', () => {
    const patches: LiveStatePatch[] = [
      {
        type: 'truth.reinforce',
        truthId: 5,
        evidence: { messageIds: [1, 2], summary: 's', confidence: 0.8 },
      },
    ];
    const out = translateLivePatches(patches, map);
    expect(out[0]).toMatchObject({ type: 'truth.reinforce', truthId: 5 });
    expect(out[0].evidence.messageIds).toEqual([150, 161]);
  });
});

describe('translateEvolutionPatches', () => {
  it('maps evidence.messageIds for evolution patches', () => {
    const patches: EvolutionPatch[] = [
      {
        type: 'personality.add_signal',
        area: 'identity',
        polarity: 'reinforce',
        text: 't',
        evidence: { messageIds: [2], summary: 's', confidence: 0.5 },
      },
    ];
    const out = translateEvolutionPatches(patches, map);
    expect(out[0].evidence.messageIds).toEqual([161]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/OrdinalTranslation.test.ts`
Expected: FAIL — cannot find module `OrdinalTranslation`.

- [ ] **Step 3: Write the implementation**

```ts
// src/application/behavior/OrdinalTranslation.ts
import type { MessageReferenceMap } from '@/application/prompts/MessageReferenceMap';
import type { BehaviorGateDecision } from '@/domain/behavior/schemas/gate';
import type {
  EvolutionPatch,
  LiveStatePatch,
} from '@/domain/behavior/schemas/patches';
import type { PatchEvidence } from '@/domain/behavior/schemas/primitives';

export function translateGateDecision(
  decision: BehaviorGateDecision,
  refMap: MessageReferenceMap
): BehaviorGateDecision {
  return {
    ...decision,
    triggerMessageIds: refMap.translate(decision.triggerMessageIds),
    contextMessageIds: refMap.translate(decision.contextMessageIds),
  };
}

function withTranslatedEvidence<P extends { evidence: PatchEvidence }>(
  patch: P,
  refMap: MessageReferenceMap
): P {
  return {
    ...patch,
    evidence: {
      ...patch.evidence,
      messageIds: refMap.translate(patch.evidence.messageIds),
    },
  };
}

export function translateLivePatches(
  patches: readonly LiveStatePatch[],
  refMap: MessageReferenceMap
): LiveStatePatch[] {
  return patches.map((patch) => withTranslatedEvidence(patch, refMap));
}

export function translateEvolutionPatches(
  patches: readonly EvolutionPatch[],
  refMap: MessageReferenceMap
): EvolutionPatch[] {
  return patches.map((patch) => withTranslatedEvidence(patch, refMap));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/OrdinalTranslation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
pnpm format:fix && pnpm lint:fix && pnpm type:check
git add src/application/behavior/OrdinalTranslation.ts test/OrdinalTranslation.test.ts
git commit -m "feat(behavior): add ordinal->storeId translation helpers"
```

---

## Task 3: Render `[#N]` + reply/quote in `addBehaviorMessages`

**Files:**
- Modify: `src/application/prompts/PromptBuilder.ts` (method `addBehaviorMessages`, lines ~306-341)
- Test: `test/PromptBuilderBehaviorMessages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/PromptBuilderBehaviorMessages.test.ts
import { describe, expect, it } from 'vitest';

import { PromptBuilder } from '../src/application/prompts/PromptBuilder';
import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';
import type { PromptTemplateService } from '../src/application/interfaces/prompts/PromptTemplateService';
import type { BehaviorPromptMessage } from '../src/application/prompts/PromptTypes';

const templates: PromptTemplateService = {
  loadTemplate: async (name: string) =>
    name === 'behaviorMessages' ? '{{behaviorMessages}}' : '',
} as unknown as PromptTemplateService;

const messages: BehaviorPromptMessage[] = [
  {
    id: 150,
    chatId: -100,
    role: 'user',
    content: 'Оооо, москалик',
    username: 'sayboter',
    fullName: 'Даниил Попырев',
    userId: 464151358,
    messageId: 33520,
  },
  {
    id: 161,
    chatId: -100,
    role: 'user',
    content: 'Я не понял',
    username: 'sayboter',
    userId: 464151358,
    messageId: 33538,
    replyText: 'раз на раз в телеге вызывает',
    replyUsername: 'khmilevoi',
  },
];

describe('PromptBuilder.addBehaviorMessages', () => {
  it('renders ordinal refs, reply lines, markers and no raw store/telegram ids', async () => {
    const refMap = MessageReferenceMap.fromMessages(messages);
    const builder = new PromptBuilder(templates);
    const [out] = await builder
      .addBehaviorMessages(messages, refMap, {
        triggerMessageIds: [161],
        contextMessageIds: [],
        batchMessageIds: [161],
      })
      .build();

    expect(out.content).toContain('[#1]');
    expect(out.content).toContain('[#2]');
    expect(out.content).toContain('[TRIGGER]');
    expect(out.content).toContain('[BATCH]');
    expect(out.content).toContain('khmilevoi');
    expect(out.content).toContain('раз на раз в телеге вызывает');
    expect(out.content).toContain('[userId:464151358]');
    expect(out.content).not.toContain('storeId');
    expect(out.content).not.toContain('telegramId');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/PromptBuilderBehaviorMessages.test.ts`
Expected: FAIL — `addBehaviorMessages` does not accept a `refMap` argument / still contains `storeId`.

- [ ] **Step 3: Update the import and method in `PromptBuilder.ts`**

Add the `MessageReferenceMap` import near the top of the file (after the other relative imports):

```ts
import type { MessageReferenceMap } from './MessageReferenceMap';
```

Replace the entire `addBehaviorMessages` method (currently lines ~306-341) with:

```ts
  addBehaviorMessages(
    messages: BehaviorPromptMessage[],
    refMap: MessageReferenceMap,
    markers?: BehaviorMessageMarkers
  ): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('behaviorMessages');
      const triggerSet = new Set(markers?.triggerMessageIds ?? []);
      const contextSet = new Set(markers?.contextMessageIds ?? []);
      const batchSet = new Set(markers?.batchMessageIds ?? []);
      const lines = messages.map((m) => {
        const markerParts = [];
        if (triggerSet.has(m.id)) {
          markerParts.push('[TRIGGER]');
        }
        if (contextSet.has(m.id)) {
          markerParts.push('[GATE_CONTEXT]');
        }
        if (batchSet.has(m.id)) {
          markerParts.push('[BATCH]');
        }
        const marker =
          markerParts.length > 0 ? ` ${markerParts.join(' ')}` : '';
        const fullName =
          m.fullName ??
          ([m.firstName, m.lastName].filter(Boolean).join(' ') || 'N/A');
        const ordinal = refMap.ordinalFor(m.id) ?? 0;
        const header = `[#${ordinal}] [userId:${m.userId ?? 0}] [username:${m.username ?? 'N/A'}] [fullName:${fullName}] [role:${m.role}]${marker}`;
        const replyLine =
          m.replyText != null && m.replyText.length > 0
            ? `\n↳ ответ @${m.replyUsername ?? 'N/A'}: "${this.truncate(m.replyText)}"`
            : '';
        const quoteLine =
          m.quoteText != null && m.quoteText.length > 0
            ? `\n❝ цитата: "${this.truncate(m.quoteText)}"`
            : '';
        return `${header}${replyLine}${quoteLine}\n${m.content}`;
      });
      return [
        {
          role: 'user',
          content: template.replace('{{behaviorMessages}}', lines.join('\n\n')),
        },
      ];
    });
    return this;
  }

  private truncate(text: string, max = 200): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- test/PromptBuilderBehaviorMessages.test.ts`
Expected: PASS.

Note: `pnpm type:check` will now report errors in `PromptDirector.ts` because `addBehaviorMessages` requires a new argument. That is expected and fixed in Task 4.

- [ ] **Step 5: Commit**

```bash
pnpm format:fix && pnpm lint:fix
git add src/application/prompts/PromptBuilder.ts test/PromptBuilderBehaviorMessages.test.ts
git commit -m "feat(prompts): render ordinal refs and reply/quote lines, drop raw ids"
```

(Skip `pnpm type:check` in this commit — it is green again after Task 4.)

---

## Task 4: Thread the ref map through `PromptDirector`

**Files:**
- Modify: `src/application/prompts/PromptDirector.ts`

- [ ] **Step 1: Add the import**

Add after the existing relative imports:

```ts
import type { MessageReferenceMap } from './MessageReferenceMap';
```

- [ ] **Step 2: Update `createBehaviorGatePrompt`**

Replace the method with:

```ts
  async createBehaviorGatePrompt(
    messages: BehaviorPromptMessage[],
    refMap: MessageReferenceMap
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addBehaviorGateSystem()
      .addBehaviorMessages(messages, refMap)
      .build();
  }
```

- [ ] **Step 3: Update `createBehaviorDecisionPrompt`**

Change the signature to accept `refMap` and pass it to `addBehaviorMessages`:

```ts
  async createBehaviorDecisionPrompt(
    context: BehaviorPromptContext,
    refMap: MessageReferenceMap
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addNeutralCore()
      .addBehaviorDecisionSystem()
      .addAskSummary(context.summary)
      .addPersonalityState(context.state.personality)
      .addPoliticalState(context.state.political)
      .addUserProfiles(context.state.profiles)
      .addUserPoliticalProfiles(context.state.userPolitical)
      .addTruths(context.state.truths)
      .addBehaviorMessages(context.messages, refMap, {
        triggerMessageIds: context.triggerMessageIds,
        contextMessageIds: context.contextMessageIds,
        batchMessageIds: context.batchMessageIds,
      })
      .build();
  }
```

- [ ] **Step 4: Update `createStateEvolutionPrompt`**

```ts
  async createStateEvolutionPrompt(
    context: StateEvolutionContext,
    refMap: MessageReferenceMap
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addNeutralCore()
      .addStateEvolutionSystem()
      .addAskSummary(context.summary)
      .addPersonalityState(context.state.personality)
      .addPersonalitySignals(context.personalitySignals)
      .addPoliticalState(context.state.political)
      .addUserProfiles(context.state.profiles)
      .addUserPoliticalProfiles(context.state.userPolitical)
      .addTruths(context.state.truths)
      .addBehaviorMessages(context.messages, refMap)
      .build();
  }
```

- [ ] **Step 5: Verify (type-check still red until Task 5 — that's expected)**

Run: `pnpm type:check`
Expected: the only remaining errors are in `ChatGPTService.ts` (callers of these three methods). Those are fixed in Task 5. Do not commit yet — commit together with Task 5 so the tree stays green.

---

## Task 5: Build the ref map and translate responses in `ChatGPTService`

**Files:**
- Modify: `src/infrastructure/external/ChatGPTService.ts`

- [ ] **Step 1: Add imports**

Add with the other imports:

```ts
import { MessageReferenceMap } from '@/application/prompts/MessageReferenceMap';
import {
  translateEvolutionPatches,
  translateGateDecision,
  translateLivePatches,
} from '@/application/behavior/OrdinalTranslation';
```

- [ ] **Step 2: Update `evaluateGate`**

In `evaluateGate`, build the map, pass it to the prompt, and translate the parsed decision. Replace the body from the `const prompt = ...` line through the `return { decision: parsed.data, ... }` with:

```ts
    const refMap = MessageReferenceMap.fromMessages(messages);
    const prompt = await this.prompts.createBehaviorGatePrompt(messages, refMap);
    const openaiMessages = this.toOpenAiMessages(prompt);
    const start = Date.now();

    const completion = await this.openai.chat.completions.parse({
      model: this.triggerGateModel,
      messages: openaiMessages,
      response_format: behaviorGateResponseFormat,
    });

    const latencyMs = Date.now() - start;
    const raw = completion.choices[0]?.message?.parsed;
    void this.logPrompt('behaviorGate', openaiMessages, raw);

    if (raw == null) {
      throw new Error('Failed to parse evaluateGate JSON response');
    }

    const parsed = behaviorGateDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
      );
    }

    return {
      decision: translateGateDecision(parsed.data, refMap),
      metadata: this.buildMetadata(
        'triggerGate',
        this.triggerGateModel,
        false,
        null,
        latencyMs,
        completion.usage
      ),
    };
```

- [ ] **Step 3: Update `decideBehavior`**

Build the map before the prompt and pass it in. Change these two lines:

```ts
    const prompt = await this.prompts.createBehaviorDecisionPrompt(context);
```

to:

```ts
    const refMap = MessageReferenceMap.fromMessages(context.messages);
    const prompt = await this.prompts.createBehaviorDecisionPrompt(
      context,
      refMap
    );
```

Then, inside the `attempt` closure, right after the successful parse (replace `const decision = parsed.data;`) with:

```ts
      const decision = {
        ...parsed.data,
        statePatches: translateLivePatches(parsed.data.statePatches, refMap),
      };
```

(The escalation checks use `decision.confidence` and `decision.actions`, which are unchanged, so they keep working.)

- [ ] **Step 4: Update `proposeStateEvolution`**

Change:

```ts
    const prompt = await this.prompts.createStateEvolutionPrompt(context);
```

to:

```ts
    const refMap = MessageReferenceMap.fromMessages(context.messages);
    const prompt = await this.prompts.createStateEvolutionPrompt(
      context,
      refMap
    );
```

Then inside the `attempt` closure, after the parse succeeds, build a translated decision and use it for the radical check and the return. Replace:

```ts
      if (
        model !== this.stateEvolutionEscalationModel &&
        this.hasRadicalPatch(parsed.data.evolutionPatches)
      ) {
        return attempt(this.stateEvolutionEscalationModel, 'radical_review');
      }

      return {
        decision: parsed.data,
        metadata: this.buildMetadata(
```

with:

```ts
      const decision = {
        ...parsed.data,
        evolutionPatches: translateEvolutionPatches(
          parsed.data.evolutionPatches,
          refMap
        ),
      };

      if (
        model !== this.stateEvolutionEscalationModel &&
        this.hasRadicalPatch(decision.evolutionPatches)
      ) {
        return attempt(this.stateEvolutionEscalationModel, 'radical_review');
      }

      return {
        decision,
        metadata: this.buildMetadata(
```

- [ ] **Step 5: Verify type-check and existing tests are green**

Run: `pnpm type:check && pnpm test`
Expected: type-check passes; full test suite passes (Tasks 1-3 tests included).

- [ ] **Step 6: Commit Tasks 4 + 5 together**

```bash
pnpm format:fix && pnpm lint:fix
git add src/application/prompts/PromptDirector.ts src/infrastructure/external/ChatGPTService.ts
git commit -m "feat(behavior): remap message refs to ordinals at the AI boundary"
```

---

## Task 6: `sendMessage` returns the Telegram message id

**Files:**
- Modify: `src/application/interfaces/chat/ChatMessenger.ts`
- Modify: `src/view/telegram/TelegramMessenger.ts`

- [ ] **Step 1: Update the interface**

In `ChatMessenger.ts`, change:

```ts
  sendMessage(chatId: number, text: string, extra?: object): Promise<void>;
```

to:

```ts
  sendMessage(
    chatId: number,
    text: string,
    extra?: object
  ): Promise<number | null>;
```

- [ ] **Step 2: Update the implementation**

In `TelegramMessenger.ts`, change `sendMessage` to return the sent message id:

```ts
  async sendMessage(
    chatId: number,
    text: string,
    extra?: object
  ): Promise<number | null> {
    const sent = await this._bot.api.sendMessage(chatId, text, extra);
    return sent?.message_id ?? null;
  }
```

- [ ] **Step 3: Verify the tree compiles**

Run: `pnpm type:check`
Expected: PASS. Existing callers that `await messenger.sendMessage(...)` without using the return value still compile (the wider return type is ignored). The behavior executor is updated in Task 7.

- [ ] **Step 4: Commit**

```bash
pnpm format:fix && pnpm lint:fix
git add src/application/interfaces/chat/ChatMessenger.ts src/view/telegram/TelegramMessenger.ts
git commit -m "feat(messenger): return sent telegram message id from sendMessage"
```

---

## Task 7: Persist bot replies as `role:assistant`

**Files:**
- Modify: `src/application/behavior/DefaultBehaviorExecutor.ts`
- Test: `test/DefaultBehaviorExecutor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/DefaultBehaviorExecutor.test.ts
import { describe, expect, it, vi } from 'vitest';

import { DefaultBehaviorExecutor } from '../src/application/behavior/DefaultBehaviorExecutor';
import type { ChatMessenger } from '../src/application/interfaces/chat/ChatMessenger';
import type { MessageService } from '../src/application/interfaces/messages/MessageService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { BehaviorRateLimiter } from '../src/application/behavior/BehaviorRateLimiter';
import type { BehaviorSummarizationQueue } from '../src/application/behavior/BehaviorSummarizationQueue';
import type { BehaviorDecisionContext } from '../src/application/behavior/BehaviorTypes';
import type { BehaviorAction } from '../src/domain/behavior/schemas/actions';

function makeContext(): BehaviorDecisionContext {
  return {
    chatId: -100,
    gate: {
      shouldDecide: true,
      confidence: 1,
      reason: 'direct_trigger',
      triggerMessageIds: [161],
      contextMessageIds: [],
      stateImpactRisk: 'low',
    },
    summary: '',
    messages: [
      { id: 161, chatId: -100, role: 'user', content: 'hi', messageId: 33538 },
    ],
    triggerMessageIds: [161],
    contextMessageIds: [],
    batchMessageIds: [161],
    state: {
      personality: {} as never,
      political: {} as never,
      profiles: [],
      truths: [],
      userPolitical: [],
    },
  };
}

const loggerFactory: LoggerFactory = {
  create: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
} as unknown as LoggerFactory;

const rateLimiter: BehaviorRateLimiter = {
  checkAction: () => ({ allowed: true, reason: null }),
  checkPatch: () => ({ allowed: true, reason: null }),
} as unknown as BehaviorRateLimiter;

const summarizationQueue = {
  enqueueOrBump: () => ({ outcome: 'queued' }),
} as unknown as BehaviorSummarizationQueue;

const replyAction: BehaviorAction = {
  type: 'reply',
  intent: 'banter',
  text: 'мой ответ',
  target: { kind: 'message', selector: { scope: 'trigger', pick: 'latest' } },
};

describe('DefaultBehaviorExecutor assistant persistence', () => {
  it('persists the assistant reply after a successful send', async () => {
    const addMessage = vi.fn().mockResolvedValue(999);
    const messages: MessageService = {
      addMessage,
    } as unknown as MessageService;
    const messenger: ChatMessenger = {
      sendMessage: vi.fn().mockResolvedValue(55501),
      bot: { botInfo: { id: 42, username: 'carl_bot' } },
    } as unknown as ChatMessenger;

    const executor = new DefaultBehaviorExecutor(
      messenger,
      rateLimiter,
      summarizationQueue,
      messages,
      loggerFactory
    );

    const results = await executor.execute({
      context: makeContext(),
      actions: [replyAction],
    });

    expect(results[0].outcome).toBe('sent');
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: 'мой ответ',
        chatId: -100,
        messageId: 55501,
        userId: 42,
        username: 'carl_bot',
      })
    );
  });

  it('does not persist when the send fails', async () => {
    const addMessage = vi.fn();
    const messages: MessageService = {
      addMessage,
    } as unknown as MessageService;
    const messenger: ChatMessenger = {
      sendMessage: vi.fn().mockRejectedValue(new Error('telegram down')),
      bot: { botInfo: { id: 42, username: 'carl_bot' } },
    } as unknown as ChatMessenger;

    const executor = new DefaultBehaviorExecutor(
      messenger,
      rateLimiter,
      summarizationQueue,
      messages,
      loggerFactory
    );

    const results = await executor.execute({
      context: makeContext(),
      actions: [replyAction],
    });

    expect(results[0].outcome).toBe('failed');
    expect(addMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- test/DefaultBehaviorExecutor.test.ts`
Expected: FAIL — `DefaultBehaviorExecutor` constructor takes 3 args, not 5 / `addMessage` not called.

- [ ] **Step 3: Update the executor**

Add imports near the top of `DefaultBehaviorExecutor.ts`:

```ts
import {
  MESSAGE_SERVICE_ID,
  type MessageService,
} from '@/application/interfaces/messages/MessageService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
```

Replace the constructor with (adds `messages` + a logger):

```ts
  private readonly logger: Logger;

  constructor(
    @inject(CHAT_MESSENGER_ID) private readonly messenger: ChatMessenger,
    @inject(BEHAVIOR_RATE_LIMITER_ID)
    private readonly rateLimiter: BehaviorRateLimiter,
    @inject(BEHAVIOR_SUMMARIZATION_QUEUE_ID)
    private readonly summarizationQueue: BehaviorSummarizationQueue,
    @inject(MESSAGE_SERVICE_ID) private readonly messages: MessageService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('DefaultBehaviorExecutor');
  }
```

In `executeReply`, capture the sent id and persist the assistant message. Replace the `try { ... }` block (the `await this.messenger.sendMessage(...)` and its `return`) with:

```ts
    try {
      const telegramMessageId = await this.messenger.sendMessage(
        context.chatId,
        action.text,
        extra
      );
      await this.persistAssistant({
        chatId: context.chatId,
        text: action.text,
        telegramMessageId,
        replyToStoredId: target.targetMessageId,
        contextMessages: context.messages,
      });
      return {
        actionType: action.type,
        outcome: 'sent',
        reason: null,
        targetMessageId: target.targetMessageId,
        telegramMessageId: target.telegramMessageId,
      };
    } catch (error) {
      return this.failed(action.type, error);
    }
```

In `executeAskQuestion`, do the same (no reply target). Replace its `try` block with:

```ts
    try {
      const telegramMessageId = await this.messenger.sendMessage(
        context.chatId,
        this.formatQuestion(action)
      );
      await this.persistAssistant({
        chatId: context.chatId,
        text: this.formatQuestion(action),
        telegramMessageId,
        replyToStoredId: null,
        contextMessages: context.messages,
      });
      return {
        actionType: action.type,
        outcome: 'sent',
        reason: null,
      };
    } catch (error) {
      return this.failed(action.type, error);
    }
```

Add the private helper (place it just above `private failed(...)`):

```ts
  private async persistAssistant(params: {
    chatId: number;
    text: string;
    telegramMessageId: number | null;
    replyToStoredId: number | null;
    contextMessages: BehaviorDecisionContext['messages'];
  }): Promise<void> {
    const botInfo = this.messenger.bot.botInfo;
    const repliedTo =
      params.replyToStoredId != null
        ? params.contextMessages.find((m) => m.id === params.replyToStoredId)
        : undefined;
    try {
      await this.messages.addMessage({
        role: 'assistant',
        content: params.text,
        chatId: params.chatId,
        messageId: params.telegramMessageId ?? undefined,
        userId: botInfo.id,
        username: botInfo.username,
        replyText: repliedTo?.content,
        replyUsername: repliedTo?.username,
      });
    } catch (error) {
      this.logger.warn(
        { error, chatId: params.chatId },
        'Failed to persist assistant message'
      );
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- test/DefaultBehaviorExecutor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify the whole suite + types**

Run: `pnpm type:check && pnpm test`
Expected: PASS. (The DI container binding `.to(DefaultBehaviorExecutor)` auto-resolves the new `MESSAGE_SERVICE_ID` and `LOGGER_FACTORY_ID` dependencies, both already registered — no container change needed.)

- [ ] **Step 6: Commit**

```bash
pnpm format:fix && pnpm lint:fix
git add src/application/behavior/DefaultBehaviorExecutor.ts test/DefaultBehaviorExecutor.test.ts
git commit -m "feat(behavior): persist bot replies as assistant messages"
```

---

## Task 8: Validator backstop — strip leaked rendered tags from visible text

**Files:**
- Modify: `src/application/behavior/DefaultBehaviorDecisionValidator.ts`
- Test: `test/DefaultBehaviorDecisionValidator.test.ts`

The structural remap is the primary guarantee; this is a narrow defense-in-depth net that removes rendered tag tokens (`[#N]`, `[userId:..]`, `[username:..]`, `[fullName:..]`, `[role:..]`) if the model ever copies them into `reply`/`ask_question` text. It deliberately does NOT touch bare `#N` (would harm legit hashtags).

- [ ] **Step 1: Write the failing test**

```ts
// test/DefaultBehaviorDecisionValidator.test.ts
import { describe, expect, it } from 'vitest';

import { DefaultBehaviorDecisionValidator } from '../src/application/behavior/DefaultBehaviorDecisionValidator';
import type { BehaviorDecisionValidatorConfig } from '../src/application/behavior/BehaviorDecisionValidator';

const config: BehaviorDecisionValidatorConfig = {
  maxReplyLength: 4000,
  allowedEmoji: ['🔥'],
};

function makeRaw(text: string): unknown {
  return {
    confidence: 0.9,
    actions: [
      { type: 'reply', intent: 'banter', text, target: { kind: 'none' } },
    ],
    statePatches: [],
    safetyNotes: [],
  };
}

describe('DefaultBehaviorDecisionValidator leak guard', () => {
  it('strips rendered reference tags from reply text', () => {
    const validator = new DefaultBehaviorDecisionValidator(config);
    const result = validator.validate(
      makeRaw('Про Даниила [#3] [userId:464151358] [role:user] вот так')
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const [action] = result.decision.actions;
      expect(action.type).toBe('reply');
      if (action.type === 'reply') {
        expect(action.text).not.toContain('[#3]');
        expect(action.text).not.toContain('[userId:');
        expect(action.text).not.toContain('[role:');
        expect(action.text).toContain('Про Даниила');
        expect(action.text).toContain('вот так');
      }
    }
  });

  it('keeps normal text with a hashtag untouched', () => {
    const validator = new DefaultBehaviorDecisionValidator(config);
    const result = validator.validate(makeRaw('лучший #1 в чате'));
    expect(result.ok).toBe(true);
    if (result.ok && result.decision.actions[0].type === 'reply') {
      expect(result.decision.actions[0].text).toBe('лучший #1 в чате');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- test/DefaultBehaviorDecisionValidator.test.ts`
Expected: FAIL — text still contains `[#3]`.

- [ ] **Step 3: Add the sanitizer to the validator**

In `DefaultBehaviorDecisionValidator.ts`, add a module-level constant and helper above the class:

```ts
const LEAKED_TAG_PATTERN =
  /\[\s*(?:#\d+|storeId|telegramId|userId|username|fullName|role)\b[^\]]*\]/gi;

function stripLeakedTags(text: string): string {
  return text.replace(LEAKED_TAG_PATTERN, '').replace(/[ \t]{2,}/g, ' ').trim();
}
```

Then in the `case 'reply':` branch, sanitize before the empty/length checks. Replace the start of the reply case:

```ts
        case 'reply': {
          if (seenSingleActionTypes.has('reply')) {
            drop('duplicate reply action dropped');
            break;
          }
```

with:

```ts
        case 'reply': {
          if (seenSingleActionTypes.has('reply')) {
            drop('duplicate reply action dropped');
            break;
          }
          action.text = stripLeakedTags(action.text);
```

And in the `case 'ask_question':` branch, after the duplicate check, add the same sanitize line:

```ts
        case 'ask_question': {
          if (seenSingleActionTypes.has('ask_question')) {
            drop('duplicate ask_question action dropped');
            break;
          }
          action.text = stripLeakedTags(action.text);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- test/DefaultBehaviorDecisionValidator.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
pnpm format:fix && pnpm lint:fix && pnpm type:check
git add src/application/behavior/DefaultBehaviorDecisionValidator.ts test/DefaultBehaviorDecisionValidator.test.ts
git commit -m "feat(behavior): strip leaked reference tags from visible reply text"
```

---

## Task 9: Update system prompt wording (reference numbers + no-leak rule)

**Files:**
- Modify: `prompts/behavior_gate_system_prompt.md`
- Modify: `prompts/behavior_decision_system_prompt.md`
- Modify: `prompts/state_evolution_system_prompt.md`

- [ ] **Step 1: `behavior_gate_system_prompt.md`**

Replace the last line:

```
Use messages.id values as triggerMessageIds and contextMessageIds. Never use Telegram message_id values as evidence ids.
```

with:

```
Each message is labeled with a reference number like `#3`. Use those reference numbers (the integer after `#`) as triggerMessageIds and contextMessageIds. There are no other id systems in this prompt.
```

- [ ] **Step 2: `behavior_decision_system_prompt.md` — selector wording**

Replace:

```
For pick: first use the lowest storeId in that scope; latest use the highest storeId; index is zero-based in ascending storeId order; all selects every message in that scope.
```

with:

```
For pick: first uses the earliest message in that scope; latest uses the most recent; index is zero-based in chronological order; all selects every message in that scope.
```

- [ ] **Step 3: `behavior_decision_system_prompt.md` — evidence wording**

Replace the final line:

```
Use evidence.messageIds from messages.id values visible in the prompt. Keep patch evidence small, specific, and tied to the triggering context.
```

with:

```
Use the `#N` reference numbers shown beside each message for evidence.messageIds (the integer after `#`). Never write a `#N` reference, a bracketed tag (like `[#3]` or `[userId:…]`), or any internal id into visible text (reply / ask_question / react). Keep patch evidence small, specific, and tied to the triggering context.
```

- [ ] **Step 4: `state_evolution_system_prompt.md`**

Replace:

```
Propose only these patch types (with `evidence` referencing real message storeIds):
```

with:

```
Propose only these patch types (with `evidence` referencing the `#N` reference numbers shown beside each message):
```

And replace:

```
- Only propose what the evidence clearly supports. Evidence message storeIds must come from real messages in this context.
```

with:

```
- Only propose what the evidence clearly supports. Evidence reference numbers must come from the `#N` labels shown beside real messages in this context.
```

- [ ] **Step 5: Verify no stale id wording remains**

Run: `pnpm test`
Expected: full suite still PASS (templates are loaded at runtime; no test depends on the old wording).

Manually confirm the three files no longer mention `storeId`, `telegramId`, or `messages.id` (search the `prompts/` directory).

- [ ] **Step 6: Commit**

```bash
git add prompts/behavior_gate_system_prompt.md prompts/behavior_decision_system_prompt.md prompts/state_evolution_system_prompt.md
git commit -m "docs(prompts): instruct model to use #N references, never leak ids"
```

---

## Task 10: Full integration verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full pipeline of checks**

Run: `pnpm format:fix && pnpm lint:fix && pnpm type:check && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 2: Manual sanity (optional, if a dev bot token is available)**

Enable `LOG_PROMPTS`, run `pnpm dev`, send a few messages in a test chat, then inspect `prompts.log`:
- behavior message lines start with `[#N]` and contain NO `storeId`/`telegramId`;
- `reply`/`ask_question` responses contain no `#N` or bracket tags in `text`;
- after the bot replies, a later prompt's message list includes a `[role:assistant]` line for the bot's own message.

- [ ] **Step 3: Commit any formatting-only fixups (if produced)**

```bash
git add -A -- ':!docs/superpowers'
git commit -m "chore: formatting after ordinal remap work"
```

(If there is nothing to commit, skip this step.)

---

## Self-Review (completed by plan author)

**Spec coverage:**
- A (id leak): Tasks 3 (drop raw ids), 5 (ordinal remap at AI boundary), 8 (text backstop), 9 (prompt wording). ✓
- B (persist bot replies): Tasks 6 (messenger returns id) + 7 (executor persists assistant). ✓
- C (reply/quote linkage): Task 3 (reply/quote sub-lines) + Task 7 (assistant message stores replyText). ✓
- D (id-space confusion): Tasks 3 + 9 remove `telegramId` from the prompt; only `#N` references remain. ✓
- Translation before persistence: Task 5 translates in `ChatGPTService` before pipeline/applicator. ✓
- No DB migration: confirmed — only new `messages` rows. ✓

**Type consistency:** `MessageReferenceMap.fromMessages/ordinalFor/storeIdFor/translate` are used identically in Tasks 1-7. `translateGateDecision/translateLivePatches/translateEvolutionPatches` signatures match between Task 2 and Task 5. `addBehaviorMessages(messages, refMap, markers?)` matches between Task 3 and Task 4. `sendMessage(): Promise<number | null>` matches between Task 6 and Task 7.

**Placeholder scan:** no TBD/TODO; every code step shows full code.
