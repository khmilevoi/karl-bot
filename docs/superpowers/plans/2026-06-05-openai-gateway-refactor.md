# OpenAI Gateway Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate all OpenAI Node SDK runtime access behind one project-owned gateway and rename provider-named AI services into Carl/business-named services.

**Architecture:** Add `OpenAiGateway` as the single production adapter that constructs the OpenAI SDK client and calls chat completions, parsed structured output, Responses, embeddings, and audio transcription. Split the current `ChatGPTService` into `CarlContentAiService` for summary/topic generation and `CarlBehaviorModelService` for behavior/state-evolution decisions. Existing embedding and audio transcription adapters become thin application adapters that depend on the gateway instead of constructing OpenAI clients.

**Tech Stack:** TypeScript, Inversify, OpenAI Node SDK, OpenAI chat completions, OpenAI parsed structured outputs, OpenAI Responses API, OpenAI embeddings, OpenAI audio transcription, Zod, Vitest.

---

## Scope Check

This is a standalone infrastructure refactor. It must not add the fact-checker feature. It prepares the codebase so the fact-checker and other future business AI services can mock `OpenAiGateway` and never import or construct the OpenAI SDK directly.

`OpenAiGateway.createResponse()` is included because `docs/superpowers/plans/2026-06-05-fact-checker.md` depends on OpenAI Responses web search through this gateway. Do not build source-search parsing or fact-check logic in this refactor.

Do not stage or commit anything under `docs/superpowers/`. `CLAUDE.md` says these files are local-only and `.gitignore` already ignores them.

The current working tree may contain unrelated user changes. Do not revert or rewrite them. Before touching files that already appear modified, inspect them and work with the current contents.

## Documentation Checkpoint

This plan was refreshed against Context7 docs for the official OpenAI Node SDK:

- `ctx7 library` selected `/openai/openai-node` (High reputation, exact Node SDK match).
- Current OpenAI Node SDK uses `client.chat.completions.create(...)`.
- Current parsed structured outputs use `client.chat.completions.parse(...)`; do not use the removed `client.beta.chat...` namespace.
- Current Responses calls use `client.responses.create(...)` and expose `response.output_text`.
- Current embeddings calls use `client.embeddings.create(...)`.

During implementation, if OpenAI SDK API shape is unclear, re-run the required repo documentation lookup from `AGENTS.md` before changing code:

```powershell
npx ctx7@latest library "OpenAI Node SDK" "<specific OpenAI SDK question>"
npx ctx7@latest docs /openai/openai-node "<specific OpenAI SDK question>"
```

Run Context7 outside Codex's default sandbox. If Context7 quota fails, tell the user to run `npx ctx7@latest login` or set `CONTEXT7_API_KEY`; do not guess SDK syntax.

## Current State Summary

Direct OpenAI SDK runtime usage currently exists in:

- `src/infrastructure/external/ChatGPTService.ts`
  - imports `OpenAI` and `makeParseableResponseFormat`;
  - implements both `AIService` and `BehaviorAiService`;
  - owns summary/topic, behavior gate, behavior decision, and state evolution logic.
- `src/infrastructure/external/OpenAIEmbeddingService.ts`
  - imports `OpenAI`;
  - constructs its own client and calls `embeddings.create`.
- `src/infrastructure/external/OpenAIAudioTranscriptionService.ts`
  - imports `OpenAI`;
  - constructs its own client and calls `audio.transcriptions.create`.
- `src/container/application.ts`
  - binds both `AI_SERVICE_ID` and `BEHAVIOR_AI_SERVICE_ID` to `ChatGPTService`;
  - constructs audio transcription with `envService.env.OPENAI_KEY`.
- `src/container/audio-worker.ts`
  - constructs audio transcription with `envService.env.OPENAI_KEY`.

Type-only OpenAI SDK coupling also exists in:

- `src/application/interfaces/env/EnvService.ts`
- `src/infrastructure/config/DefaultEnvService.ts`
- `src/infrastructure/config/TestEnvService.ts`
- `src/application/behavior/BehaviorTypes.ts`
- `src/infrastructure/external/ChatGPTService.ts`

Remove these type-only imports too by introducing a project-owned `AiModelId = string` type. This keeps the application layer independent of OpenAI SDK package types.

## File Structure

Create:

- `src/application/interfaces/ai/AiModelId.ts`
  - Project-owned model id alias used by env slots and AI metadata.
- `src/application/interfaces/ai/OpenAiGateway.ts`
  - Project-owned gateway interface and request/result types.
- `src/infrastructure/external/OpenAiSdkGateway.ts`
  - The only production adapter that imports and constructs the OpenAI SDK value client.
- `src/application/use-cases/ai/CarlContentAiService.ts`
  - Business service for summaries and topic-of-day generation.
- `src/application/behavior/CarlBehaviorModelService.ts`
  - Business service for behavior gate, behavior decision, and state evolution model calls.
- `test/OpenAiGateway.test.ts`
- `test/CarlContentAiService.test.ts`
- `test/CarlBehaviorModelService.behavior.test.ts`
- `test/CarlBehaviorModelService.stateEvolution.test.ts`

Modify:

- `src/application/interfaces/env/EnvService.ts`
  - Replace `ChatModel` with project-owned `AiModelId`.
- `src/infrastructure/config/DefaultEnvService.ts`
  - Replace `ChatModel` casts with `AiModelId`.
- `src/infrastructure/config/TestEnvService.ts`
  - Replace `ChatModel` casts with `AiModelId`.
- `src/application/behavior/BehaviorTypes.ts`
  - Type `AiCallMetadata.selectedModel` as `AiModelId`.
- `src/infrastructure/external/ChatGPTService.ts`
  - Temporarily replace `ChatModel` fields/parameters with `AiModelId` until the file is removed in Task 3.
- `src/container/application.ts`
  - Bind the gateway and business services; construct audio transcription through the gateway.
- `src/container/audio-worker.ts`
  - Construct audio transcription through the gateway.
- `src/infrastructure/external/OpenAIEmbeddingService.ts`
  - Route embeddings through `OpenAiGateway`.
- `src/infrastructure/external/OpenAIAudioTranscriptionService.ts`
  - Route transcription through `OpenAiGateway`.
- `test/OpenAIEmbeddingService.test.ts`
- `test/VoiceExternalServices.test.ts`
- `test/container.behavior.test.ts`

Delete or stop using:

- `src/infrastructure/external/ChatGPTService.ts`
- `test/ChatGPTService.test.ts`
- `test/ChatGPTService.behavior.test.ts`
- `test/ChatGPTService.stateEvolution.test.ts`

Do not modify in this plan:

- fact-checker source files, migrations, prompts, schedulers, or env variables;
- `docs/superpowers/plans/2026-06-05-fact-checker.md`, unless a later explicit planning task requests it.

## Task 0: Preflight And Boundary Baseline

**Files:**

- Read only: repository state and existing AI files.

- [ ] **Step 1: Inspect git state**

Run:

```powershell
git status --short
```

Expected: note any unrelated modified files. Do not revert them.

- [ ] **Step 2: Inspect current OpenAI SDK imports**

Run:

```powershell
rg -n -e "new OpenAI" -e "from 'openai'" -e 'from "openai"' -e "openai/" src test
```

Expected: production runtime imports appear in `ChatGPTService.ts`, `OpenAIEmbeddingService.ts`, and `OpenAIAudioTranscriptionService.ts`; type-only imports appear in env/behavior model types.

- [ ] **Step 3: Inspect existing tests before renaming**

Run:

```powershell
pnpm test -- test/ChatGPTService.test.ts test/ChatGPTService.behavior.test.ts test/ChatGPTService.stateEvolution.test.ts test/OpenAIEmbeddingService.test.ts test/VoiceExternalServices.test.ts test/container.behavior.test.ts
```

Expected: pass before refactor. If unrelated failures exist, record them before changing code.

Do not commit this task.

## Task 1: Add Project-Owned AI Model Type

**Files:**

- Create: `src/application/interfaces/ai/AiModelId.ts`
- Modify: `src/application/interfaces/env/EnvService.ts`
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`
- Modify: `src/application/behavior/BehaviorTypes.ts`
- Modify: `src/infrastructure/external/ChatGPTService.ts`
- Test: `test/EnvService.test.ts`
- Test: `test/ChatGPTService.behavior.test.ts`
- Test: `test/ChatGPTService.stateEvolution.test.ts`

- [ ] **Step 1: Write the failing type-boundary check**

No new runtime behavior test is needed. First update imports in affected tests only if TypeScript requires it after the production type changes. The meaningful check is the source boundary search in Step 5.

- [ ] **Step 2: Create `AiModelId`**

Create `src/application/interfaces/ai/AiModelId.ts`:

```ts
export type AiModelId = string;
```

- [ ] **Step 3: Replace OpenAI SDK model types in env**

In `src/application/interfaces/env/EnvService.ts`:

```ts
import type { AiModelId } from '@/application/interfaces/ai/AiModelId';

export interface SingleModelSlot {
  default: AiModelId;
}

export interface EscalatingModelSlot {
  default: AiModelId;
  escalation: AiModelId;
}
```

Remove:

```ts
import type { ChatModel } from 'openai/resources/shared';
```

- [ ] **Step 4: Replace casts in env implementations**

In `src/infrastructure/config/DefaultEnvService.ts` and `src/infrastructure/config/TestEnvService.ts`, remove the `ChatModel` import and replace casts:

```ts
'gpt-5.4-mini' as AiModelId
'gpt-5.5' as AiModelId
```

Import `AiModelId` from the project interface file.

- [ ] **Step 5: Replace behavior metadata selected model type**

In `src/application/behavior/BehaviorTypes.ts`, remove the `ChatModel` import and use:

```ts
import type { AiModelId } from '@/application/interfaces/ai/AiModelId';

export interface AiCallMetadata {
  modelSlot: string;
  selectedModel: AiModelId;
  escalated: boolean;
  escalationReason: string | null;
  latencyMs: number;
  usage: AiCallUsage;
}
```

- [ ] **Step 6: Replace current service model fields**

In `src/infrastructure/external/ChatGPTService.ts`, remove:

```ts
import type { ChatModel } from 'openai/resources/shared';
```

Import `AiModelId` and replace all `ChatModel` field and parameter annotations with `AiModelId`. Keep the runtime `OpenAI` import for now; it is removed in Task 3.

- [ ] **Step 7: Run type boundary search**

Run:

```powershell
rg -n "openai/resources/shared|ChatModel" src
```

Expected: no results in `src/`. If tests still use `ChatModel`, replace them with plain strings unless they specifically test SDK adapter behavior.

- [ ] **Step 8: Run focused type-adjacent tests**

Run:

```powershell
pnpm test -- test/EnvService.test.ts test/ChatGPTService.behavior.test.ts test/ChatGPTService.stateEvolution.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```powershell
git add src/application/interfaces/ai/AiModelId.ts src/application/interfaces/env/EnvService.ts src/infrastructure/config/DefaultEnvService.ts src/infrastructure/config/TestEnvService.ts src/application/behavior/BehaviorTypes.ts src/infrastructure/external/ChatGPTService.ts test/EnvService.test.ts test/ChatGPTService.behavior.test.ts test/ChatGPTService.stateEvolution.test.ts
git commit -m "refactor(ai): use project model ids"
```

## Task 2: Add `OpenAiGateway`

**Files:**

- Create: `src/application/interfaces/ai/OpenAiGateway.ts`
- Create: `src/infrastructure/external/OpenAiSdkGateway.ts`
- Create: `test/OpenAiGateway.test.ts`
- Modify: `src/container/application.ts`

- [ ] **Step 1: Write failing gateway tests**

Create `test/OpenAiGateway.test.ts`. Mock `openai` only in this test file.

Assert:

- constructor creates exactly one OpenAI client with `OPENAI_KEY`;
- `createChatCompletion()` calls `client.chat.completions.create(...)`;
- `createChatCompletion()` returns first choice content, response model, normalized token usage, and raw response;
- `parseChatCompletion()` calls `client.chat.completions.parse(...)`;
- `parseChatCompletion()` passes a parseable `response_format` containing `{ type: 'json_schema', json_schema: input.responseFormat }`;
- `parseChatCompletion()` returns `choices[0].message.parsed ?? null`, response model, normalized token usage, and raw response;
- `createResponse()` calls `client.responses.create(...)`;
- `createResponse()` returns `output_text`, normalized token usage when present, and raw response;
- `createEmbeddings()` calls `client.embeddings.create(...)`;
- `createEmbeddings()` returns embeddings sorted by SDK `data[].index`;
- `createEmbeddings()` accepts readonly input and passes a copied array to the SDK;
- `transcribeAudio()` calls `client.audio.transcriptions.create(...)`;
- `transcribeAudio()` converts `ConvertedAudioFile` into a `File` and returns trimmed text;
- chat-style usage fields map from `prompt_tokens`, `completion_tokens`, `total_tokens`;
- responses-style usage fields map from `input_tokens`, `output_tokens`, `total_tokens`;
- missing SDK usage maps to `promptTokens: null`, `completionTokens: null`, `totalTokens: null`.

Test helper shape:

```ts
const openAiConstructor = vi.fn(() => ({
  chat: {
    completions: {
      create: chatCreate,
      parse: chatParse,
    },
  },
  responses: { create: responseCreate },
  embeddings: { create: embeddingsCreate },
  audio: { transcriptions: { create: transcriptionCreate } },
}));

vi.mock('openai', () => ({ default: openAiConstructor }));
```

- [ ] **Step 2: Run the failing gateway test**

Run:

```powershell
pnpm test -- test/OpenAiGateway.test.ts
```

Expected: fail because gateway files do not exist.

- [ ] **Step 3: Define gateway interface**

Create `src/application/interfaces/ai/OpenAiGateway.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import type { ConvertedAudioFile } from '@/application/interfaces/voice/AudioConversionService';
import type { OpenAiResponseFormatSchema } from '@/domain/behavior/schemas/jsonSchema';

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface OpenAiTextResult {
  content: string;
  model: AiModelId;
  usage: OpenAiUsage;
  raw: unknown;
}

export interface OpenAiParsedResult<T> {
  parsed: T | null;
  model: AiModelId;
  usage: OpenAiUsage;
  raw: unknown;
}

export interface OpenAiResponseResult {
  outputText: string;
  usage: OpenAiUsage;
  raw: unknown;
}

export interface OpenAiGateway {
  createChatCompletion(input: {
    model: AiModelId;
    messages: OpenAiMessage[];
  }): Promise<OpenAiTextResult>;

  parseChatCompletion<T>(input: {
    model: AiModelId;
    messages: OpenAiMessage[];
    responseFormat: OpenAiResponseFormatSchema;
    parse: (content: string) => T;
  }): Promise<OpenAiParsedResult<T>>;

  createResponse(input: {
    model: AiModelId;
    input: string;
    tools: unknown[];
  }): Promise<OpenAiResponseResult>;

  createEmbeddings(input: {
    model: AiModelId;
    texts: readonly string[];
  }): Promise<number[][]>;

  transcribeAudio(input: {
    model: AiModelId;
    file: ConvertedAudioFile;
  }): Promise<string>;
}

export const OPEN_AI_GATEWAY_ID = Symbol.for(
  'OpenAiGateway'
) as ServiceIdentifier<OpenAiGateway>;
```

- [ ] **Step 4: Implement SDK gateway**

Create `src/infrastructure/external/OpenAiSdkGateway.ts`.

Implementation rules:

- This is the only production file that imports `OpenAI` as a runtime value.
- This file may import SDK helper `makeParseableResponseFormat` from `openai/lib/parser`.
- It owns `new OpenAI({ apiKey: envService.env.OPENAI_KEY })`.
- It injects `ENV_SERVICE_ID`.
- It maps SDK token usage into `OpenAiUsage`; support both chat-style `prompt_tokens`/`completion_tokens` and responses-style `input_tokens`/`output_tokens`, with `total_tokens` shared.
- It returns raw SDK responses as `raw` for future auditing/debugging.
- It converts `ConvertedAudioFile` to `File` for transcription.
- It does not contain Carl/business prompt logic.
- Any cast from project-owned `tools: unknown[]` to SDK Responses tool types stays inside this gateway.

Implementation outline:

```ts
import { inject, injectable } from 'inversify';
import OpenAI from 'openai';
import { makeParseableResponseFormat } from 'openai/lib/parser';

import type {
  OpenAiGateway,
  OpenAiParsedResult,
  OpenAiResponseResult,
  OpenAiTextResult,
  OpenAiUsage,
} from '@/application/interfaces/ai/OpenAiGateway';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';

@injectable()
export class OpenAiSdkGateway implements OpenAiGateway {
  private readonly client: OpenAI;

  constructor(@inject(ENV_SERVICE_ID) envService: EnvService) {
    this.client = new OpenAI({ apiKey: envService.env.OPENAI_KEY });
  }

  // Implement the interface methods here.
}
```

Use the current SDK namespace confirmed by Context7:

```ts
await this.client.chat.completions.create(...)
await this.client.chat.completions.parse(...)
await this.client.responses.create(...)
await this.client.embeddings.create(...)
await this.client.audio.transcriptions.create(...)
```

For `parseChatCompletion()`:

```ts
const responseFormat = makeParseableResponseFormat(
  {
    type: 'json_schema',
    json_schema: input.responseFormat,
  },
  input.parse
);
```

For `transcribeAudio()`, preserve the existing `Buffer` to `File` conversion from `OpenAIAudioTranscriptionService`, then trim the SDK response text:

```ts
return result.text.trim();
```

- [ ] **Step 5: Bind gateway**

In `src/container/application.ts`, import `OpenAiGateway`, `OPEN_AI_GATEWAY_ID`, and `OpenAiSdkGateway`, then bind after `ENV_SERVICE_ID` is bound and before services that need the gateway:

```ts
container
  .bind<OpenAiGateway>(OPEN_AI_GATEWAY_ID)
  .to(OpenAiSdkGateway)
  .inSingletonScope();
```

Do not change `ChatGPTService`, embedding, or audio bindings yet in this task.

- [ ] **Step 6: Run gateway tests**

Run:

```powershell
pnpm test -- test/OpenAiGateway.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add src/application/interfaces/ai/OpenAiGateway.ts src/infrastructure/external/OpenAiSdkGateway.ts src/container/application.ts test/OpenAiGateway.test.ts
git commit -m "refactor(ai): add OpenAI gateway"
```

## Task 3: Split `ChatGPTService` Into Business Services

**Files:**

- Create: `src/application/use-cases/ai/CarlContentAiService.ts`
- Create: `src/application/behavior/CarlBehaviorModelService.ts`
- Modify: `src/container/application.ts`
- Delete: `src/infrastructure/external/ChatGPTService.ts`
- Rename:
  - `test/ChatGPTService.test.ts` -> `test/CarlContentAiService.test.ts`
  - `test/ChatGPTService.behavior.test.ts` -> `test/CarlBehaviorModelService.behavior.test.ts`
  - `test/ChatGPTService.stateEvolution.test.ts` -> `test/CarlBehaviorModelService.stateEvolution.test.ts`

- [ ] **Step 1: Rename tests**

Run:

```powershell
git mv test/ChatGPTService.test.ts test/CarlContentAiService.test.ts
git mv test/ChatGPTService.behavior.test.ts test/CarlBehaviorModelService.behavior.test.ts
git mv test/ChatGPTService.stateEvolution.test.ts test/CarlBehaviorModelService.stateEvolution.test.ts
```

If these files are modified by the user, inspect them first and apply the rename carefully without losing edits.

- [ ] **Step 2: Change content-service tests to mock the gateway**

In `test/CarlContentAiService.test.ts`:

- replace `ChatGPTService` imports/types with `CarlContentAiService`;
- remove `vi.doMock('openai', ...)`;
- create a fake `OpenAiGateway` with `createChatCompletion`;
- instantiate service as:

```ts
service = new CarlContentAiService(
  env,
  prompts as unknown as PromptDirector,
  gateway,
  loggerFactory
);
```

Update expectations:

- `generateTopicOfDay()` calls `gateway.createChatCompletion({ model: env.getModels().behaviorDecision.default, messages })`;
- `summarize()` calls `gateway.createChatCompletion({ model: env.getModels().summarization.default, messages })`;
- fallback behavior remains `content ?? prev ?? ''` by using gateway result content `''` for missing provider content;
- `LOG_PROMPTS` behavior still writes only when enabled.

- [ ] **Step 3: Change behavior-service tests to mock the gateway**

In `test/CarlBehaviorModelService.behavior.test.ts` and `test/CarlBehaviorModelService.stateEvolution.test.ts`:

- replace `ChatGPTService` imports/types with `CarlBehaviorModelService`;
- remove `vi.doMock('openai', ...)`;
- create a fake `OpenAiGateway` with `parseChatCompletion`;
- instantiate service as:

```ts
service = new CarlBehaviorModelService(
  env,
  prompts as unknown as PromptDirector,
  DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
  gateway,
  loggerFactory
);
```

Update expectations:

- gateway receives `responseFormat: behaviorGateJsonSchema`;
- gateway receives `responseFormat: behaviorDecisionJsonSchema`;
- gateway receives `responseFormat: stateEvolutionJsonSchema`;
- gateway receives the correct default/escalation model;
- schema validation, escalation behavior, ordinal translation, latency, usage metadata, and prompt logging behavior remain covered.

Gateway fake result shape:

```ts
parseChatCompletion.mockResolvedValue({
  parsed: validDecision,
  model: env.getModels().behaviorDecision.default,
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  raw: {},
});
```

- [ ] **Step 4: Run renamed tests to verify they fail**

Run:

```powershell
pnpm test -- test/CarlContentAiService.test.ts test/CarlBehaviorModelService.behavior.test.ts test/CarlBehaviorModelService.stateEvolution.test.ts
```

Expected: fail because business services do not exist yet.

- [ ] **Step 5: Create `CarlContentAiService`**

Create `src/application/use-cases/ai/CarlContentAiService.ts`.

Move from current `ChatGPTService`:

- `generateTopicOfDay()`;
- `summarize()`;
- `logPrompt()` helper;
- `toOpenAiMessages()` helper, typed against `OpenAiMessage[]`.

Rules:

- implements `AIService`;
- injects `ENV_SERVICE_ID`, `PROMPT_DIRECTOR_ID`, `OPEN_AI_GATEWAY_ID`, `LOGGER_FACTORY_ID`;
- reads models from `envService.getModels()`;
- uses `OpenAiGateway.createChatCompletion()`;
- does not import `openai` or `openai/*`;
- logger component name is `CarlContentAiService`.

Constructor outline:

```ts
constructor(
  @inject(ENV_SERVICE_ID) private readonly envService: EnvService,
  @inject(PROMPT_DIRECTOR_ID) private readonly prompts: PromptDirector,
  @inject(OPEN_AI_GATEWAY_ID) private readonly gateway: OpenAiGateway,
  @inject(LOGGER_FACTORY_ID) private readonly loggerFactory: LoggerFactory
) {
  const models = this.envService.getModels();
  this.behaviorDecisionModel = models.behaviorDecision.default;
  this.summarizationModel = models.summarization.default;
  this.logger = this.loggerFactory.create('CarlContentAiService');
}
```

- [ ] **Step 6: Create `CarlBehaviorModelService`**

Create `src/application/behavior/CarlBehaviorModelService.ts`.

Move from current `ChatGPTService`:

- `evaluateGate()`;
- `decideBehavior()`;
- `proposeStateEvolution()`;
- `hasRadicalPatch()`;
- `checkDecisionEscalation()`;
- `checkConflictingVisibleActions()`;
- `buildMetadata()`;
- `logPrompt()` helper;
- `toOpenAiMessages()` helper.

Rules:

- implements `BehaviorAiService`;
- injects `ENV_SERVICE_ID`, `PROMPT_DIRECTOR_ID`, `BEHAVIOR_PIPELINE_CONFIG_ID`, `OPEN_AI_GATEWAY_ID`, `LOGGER_FACTORY_ID`;
- reads models from `envService.getModels()`;
- uses `OpenAiGateway.parseChatCompletion()`;
- passes `responseFormat` and Zod parser explicitly:

```ts
await this.gateway.parseChatCompletion({
  model,
  messages: openaiMessages,
  responseFormat: behaviorDecisionJsonSchema,
  parse: (content) => {
    const parsed: unknown = JSON.parse(content);
    return behaviorDecisionSchema.parse(parsed);
  },
});
```

- validates `result.parsed` again with the existing `safeParse` logic before translating patches;
- maps metadata usage from gateway camelCase usage, not SDK snake_case usage;
- does not import `openai` or `openai/*`;
- logger component name is `CarlBehaviorModelService`.

Update `buildMetadata()` signature:

```ts
private buildMetadata(
  modelSlot: string,
  selectedModel: AiModelId,
  escalated: boolean,
  escalationReason: string | null,
  latencyMs: number,
  usage: OpenAiUsage
): AiCallMetadata
```

- [ ] **Step 7: Update DI**

In `src/container/application.ts`:

```ts
container
  .bind<AIService>(AI_SERVICE_ID)
  .to(CarlContentAiService)
  .inSingletonScope();

container
  .bind<BehaviorAiService>(BEHAVIOR_AI_SERVICE_ID)
  .to(CarlBehaviorModelService)
  .inSingletonScope();
```

Remove imports and bindings for `ChatGPTService`.

In `test/container.behavior.test.ts`, add explicit assertions:

```ts
expect(container.get(AI_SERVICE_ID)).toBeTruthy();
expect(container.get(BEHAVIOR_AI_SERVICE_ID)).toBeTruthy();
expect(container.get(OPEN_AI_GATEWAY_ID)).toBeTruthy();
```

- [ ] **Step 8: Remove old service file**

Run:

```powershell
git rm src/infrastructure/external/ChatGPTService.ts
```

- [ ] **Step 9: Run business service tests**

Run:

```powershell
pnpm test -- test/CarlContentAiService.test.ts test/CarlBehaviorModelService.behavior.test.ts test/CarlBehaviorModelService.stateEvolution.test.ts test/container.behavior.test.ts
```

Expected: pass.

- [ ] **Step 10: Run OpenAI import boundary search**

Run:

```powershell
rg -n -e "ChatGPTService" -e "openai/" -e "from 'openai'" -e 'from "openai"' src test
```

Expected:

- no `ChatGPTService` references in `src` or renamed tests;
- `openai` references only in `src/infrastructure/external/OpenAiSdkGateway.ts` and `test/OpenAiGateway.test.ts`.

Historical docs under `docs/superpowers/` may still mention `ChatGPTService`; do not edit them in this implementation plan.

- [ ] **Step 11: Commit**

```powershell
git add src/application/use-cases/ai/CarlContentAiService.ts src/application/behavior/CarlBehaviorModelService.ts src/container/application.ts test/CarlContentAiService.test.ts test/CarlBehaviorModelService.behavior.test.ts test/CarlBehaviorModelService.stateEvolution.test.ts test/container.behavior.test.ts
git rm src/infrastructure/external/ChatGPTService.ts test/ChatGPTService.test.ts test/ChatGPTService.behavior.test.ts test/ChatGPTService.stateEvolution.test.ts
git commit -m "refactor(ai): split Carl AI services"
```

## Task 4: Route Embedding And Audio Through Gateway

**Files:**

- Modify: `src/infrastructure/external/OpenAIEmbeddingService.ts`
- Modify: `src/infrastructure/external/OpenAIAudioTranscriptionService.ts`
- Modify: `src/container/application.ts`
- Modify: `src/container/audio-worker.ts`
- Modify: `test/OpenAIEmbeddingService.test.ts`
- Modify: `test/VoiceExternalServices.test.ts`

- [ ] **Step 1: Update embedding tests**

In `test/OpenAIEmbeddingService.test.ts`:

- remove `vi.mock('openai', ...)`;
- construct a fake `OpenAiGateway`;
- instantiate `OpenAIEmbeddingService` with the gateway;
- assert `embed(['a', 'b'])` delegates:

```ts
expect(gateway.createEmbeddings).toHaveBeenCalledWith({
  model: 'text-embedding-3-small',
  texts: ['a', 'b'],
});
```

Keep the empty-input test:

```ts
expect(gateway.createEmbeddings).not.toHaveBeenCalled();
```

- [ ] **Step 2: Update transcription tests**

In `test/VoiceExternalServices.test.ts`:

- remove the OpenAI SDK mock from the transcription section;
- construct a fake `OpenAiGateway`;
- instantiate `OpenAIAudioTranscriptionService` with `(gateway, 'gpt-4o-mini-transcribe')`;
- assert `transcribe(file)` delegates:

```ts
expect(gateway.transcribeAudio).toHaveBeenCalledWith({
  model: 'gpt-4o-mini-transcribe',
  file,
});
```

The trimming assertion now belongs in `test/OpenAiGateway.test.ts`, not this adapter test.

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
pnpm test -- test/OpenAIEmbeddingService.test.ts test/VoiceExternalServices.test.ts
```

Expected: fail because services still construct OpenAI directly.

- [ ] **Step 4: Update embedding service**

Modify `src/infrastructure/external/OpenAIEmbeddingService.ts`:

- inject `OPEN_AI_GATEWAY_ID`;
- call `gateway.createEmbeddings({ model: EMBEDDING_MODEL, texts })`;
- keep empty input short-circuit;
- remove `ENV_SERVICE_ID`, `EnvService`, runtime `OpenAI` import, and `new OpenAI(...)`.

Constructor outline:

```ts
constructor(
  @inject(OPEN_AI_GATEWAY_ID) private readonly gateway: OpenAiGateway
) {}
```

- [ ] **Step 5: Update transcription service**

Modify `src/infrastructure/external/OpenAIAudioTranscriptionService.ts`:

- accept an `OpenAiGateway` dependency and model id;
- call `gateway.transcribeAudio({ model: this.model, file })`;
- remove runtime `OpenAI` import, `new OpenAI(...)`, and `Buffer` to `File` conversion.

Constructor outline:

```ts
constructor(
  private readonly gateway: OpenAiGateway,
  private readonly model: AiModelId
) {}
```

- [ ] **Step 6: Update containers**

In `src/container/application.ts` and `src/container/audio-worker.ts`, construct audio transcription with the gateway:

```ts
const gateway = container.get<OpenAiGateway>(OPEN_AI_GATEWAY_ID);
return new OpenAIAudioTranscriptionService(
  gateway,
  voiceConfig.transcriptionModel
);
```

For `src/container/audio-worker.ts`, also import `OpenAiGateway` and `OPEN_AI_GATEWAY_ID`.

Do not bind a second gateway in `src/container/audio-worker.ts` if the application container already registered `OPEN_AI_GATEWAY_ID`; retrieve the existing binding. If a test calls `registerVoiceWorker()` without `registerApplication()`, update that test setup to register the gateway first rather than creating a parallel OpenAI client.

- [ ] **Step 7: Run embedding/audio tests**

Run:

```powershell
pnpm test -- test/OpenAIEmbeddingService.test.ts test/VoiceExternalServices.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```powershell
git add src/infrastructure/external/OpenAIEmbeddingService.ts src/infrastructure/external/OpenAIAudioTranscriptionService.ts src/container/application.ts src/container/audio-worker.ts test/OpenAIEmbeddingService.test.ts test/VoiceExternalServices.test.ts
git commit -m "refactor(ai): route OpenAI adapters through gateway"
```

## Task 5: Verify Gateway Boundary

**Files:**

- Potentially modify files touched by lint/format fixes.

- [ ] **Step 1: Search for forbidden direct SDK usage in production**

Run:

```powershell
rg -n -e "new OpenAI" -e "from 'openai'" -e 'from "openai"' -e "openai/" src
```

Expected: all results are in `src/infrastructure/external/OpenAiSdkGateway.ts`.

- [ ] **Step 2: Search for old provider-named business service**

Run:

```powershell
rg -n "ChatGPTService" src test
```

Expected: no results. Existing historical docs under `docs/superpowers/` may still mention `ChatGPTService`.

- [ ] **Step 3: Run refactor tests**

Run:

```powershell
pnpm test -- test/OpenAiGateway.test.ts test/CarlContentAiService.test.ts test/CarlBehaviorModelService.behavior.test.ts test/CarlBehaviorModelService.stateEvolution.test.ts test/OpenAIEmbeddingService.test.ts test/VoiceExternalServices.test.ts test/container.behavior.test.ts test/EnvService.test.ts
```

Expected: pass.

- [ ] **Step 4: Run type check and build**

Run:

```powershell
pnpm type:check
pnpm build
```

Expected: pass.

- [ ] **Step 5: Run full tests**

Run:

```powershell
pnpm test
```

Expected: pass.

- [ ] **Step 6: Run fixers**

Run:

```powershell
pnpm lint:fix
pnpm format:fix
```

Expected: completes successfully or makes only mechanical formatting/lint changes.

- [ ] **Step 7: Re-run final checks after fixers**

Run:

```powershell
pnpm type:check
pnpm build
pnpm test
```

Expected: pass. This is required because `format:fix` and `lint:fix` can rewrite files.

- [ ] **Step 8: Commit cleanup if needed**

If fixers changed files:

```powershell
git add <files changed by lint or format>
git commit -m "chore(ai): finalize OpenAI gateway refactor"
```

Do not commit `docs/superpowers/...`.

## Acceptance Criteria

- `OpenAiSdkGateway` is the only production file importing OpenAI SDK runtime values.
- No `src/` file imports `openai/resources/shared` or uses `ChatModel`.
- No `ChatGPTService` references remain in `src/` or `test/`.
- `AI_SERVICE_ID` resolves to `CarlContentAiService`.
- `BEHAVIOR_AI_SERVICE_ID` resolves to `CarlBehaviorModelService`.
- `EMBEDDING_SERVICE_ID` resolves to `OpenAIEmbeddingService`, which delegates to `OpenAiGateway`.
- `AUDIO_TRANSCRIPTION_SERVICE_ID` resolves to `OpenAIAudioTranscriptionService`, which delegates to `OpenAiGateway`.
- Content, behavior, embedding, transcription, and gateway tests mock `OpenAiGateway` except `test/OpenAiGateway.test.ts`, which is the only test that mocks the OpenAI SDK.
- `OpenAiGateway.createResponse()` exists for the later fact-checker source search plan, but no fact-checker behavior is implemented here.
- `pnpm type:check`, `pnpm build`, and `pnpm test` pass.

## Handoff

After this plan is complete, the fact-checker implementation plan can assume:

- `OpenAiGateway` exists;
- `OpenAiGateway.createResponse()` wraps OpenAI Responses and returns `outputText`, usage, and raw response;
- no business service constructs OpenAI SDK clients directly;
- fact-check reasoning and source search services can mock `OpenAiGateway` in tests;
- fact-check source-search parsing still belongs to the fact-checker plan, not this refactor.
