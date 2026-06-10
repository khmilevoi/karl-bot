# AI Behavior Evolution — Phase 4: State Evolution + Political Coordinates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the background state-evolution pass that, per chat, proposes personality + political + user-political patches, derives the descriptive personality/user snapshots **and the bot + user political compasses**, applies the evolution-lane patches through policy, logs a `behavior_events` row distinguished by `modelSlot: 'stateEvolution'`, and is driven by a `behavior_events` high-water-mark trigger + cooldown with a periodic cron sweep floor, owned by a single deduplicated worker per chat. This plan **absorbs the former Plan 06 (Political Coordinates)** per the 2026-05-31 decision.

**Architecture:** Phase 4 stays additive — the behavior pipeline is still not wired to live Telegram traffic (Phase 5 owns cutover). A new background lane runs alongside the live `decideBehavior` lane: `DefaultStateEvolutionPass` reads the delta of `behavior_events` since a per-chat cursor plus the current rendered state (now including the bot/user compasses, user political notes, and the append-only personality signals), asks `BehaviorAiService.proposeStateEvolution` (on the `stateEvolution` slot) for `EvolutionPatch`es + derived snapshots + derived compasses, applies them through the existing `StatePatchApplicator` (extended with `applyEvolutionPatches`) and `PatchPolicy`, writes the snapshots/compasses, logs an evolution `behavior_events` row, and advances the cursor. A `DefaultStateEvolutionWorker` dedups runs per chat, a `DefaultStateEvolutionTrigger` fires from the pipeline on the event threshold, and a `DefaultStateEvolutionScheduler` provides the cron sweep floor.

**Tech Stack:** TypeScript (CommonJS), Inversify (Symbol-based DI), Zod `^4.4.3`, OpenAI SDK `^6.39.1` (Chat Completions `parse` + `zodResponseFormat`), `node-cron`, `sqlite`/`sqlite3`, Vitest `^3`, oxlint/oxfmt.

---

## Source

- Spec: [`docs/superpowers/specs/2026-05-28-ai-behavior-evolution-design.md`](../specs/2026-05-28-ai-behavior-evolution-design.md) — State-Evolution Pass, Behavior Decision Contract (lanes), State Patch Contract (`EvolutionPatch`, best-effort partial application), Blank-Slate Personality / Personality State, Political State, **Political Coordinates (Compass Model, Bot Compass, User Political Profile, Derivation and Patches, Behavior Influence, Phasing/Testing Deltas)**, User Social Profiles, Model Routing Policy (`stateEvolution` slot), Prompt Structure, Storage, Phasing (Phase 4).
- Tracker: [`2026-05-28-ai-behavior-evolution-tracker.md`](2026-05-28-ai-behavior-evolution-tracker.md) (Plan 04 + the now-absorbed Plan 06).
- Built on the executed Phases 1–3 (current `main`).

## Locked decisions (2026-05-31 — answered by the user)

1. **Political coordinates are in this plan.** Pull the former Plan 06 (compass + user political notes) into Phase 4 to match the spec's literal Phase-4 phasing. There is no separate Plan 06; migration `016` carries all of it.
2. **Radical patches re-run on the stronger model.** When a default-model evolution proposal contains a radical political patch (`politics.add_position` `requestedIntensity: 'radical'` or `politics.adjust_position` `direction: 'radicalize'`), `proposeStateEvolution` re-runs on the escalation model (mirrors `decideBehavior` reactive escalation), and the applicator then applies the radical content (`reviewedByStrongModel: true`).
3. **Personality signals live in their own table.** A new append-only `bot_personality_signals` table — **not** a field on the rendered personality state. The live `decideBehavior` prompt renders only the derived personality fields; signals are loaded only for the evolution pass. (Political compass + user political notes *do* render into the live prompt — they are the spec's only behavior channel for coordinates.)
4. **Default cadence kept:** `eventThreshold 8`, `highRiskEventThreshold 3`, `cooldownMs 5min`, `maxIntervalMs 1h`, `sweepCron */5 * * * *`, `recentMessageLimit 60`.

## Scope Locks

- **No MainService cutover.** No Telegram routing and no cron started in `index.ts`/`MainService`. Phase 5 wires the live pipeline *and* `StateEvolutionScheduler.start()`. Phase 4 is exercised entirely through tests.
- **No git worktree** (normal branch — carry-forward from Phase 3).
- **Compasses are derived snapshots, never patched.** No `set_coordinate` patch. The pass derives `botCompass` from `positions[]` and each user compass from that user's active notes (AI-derived in the evolution call), clamped to `[-10, 10]` / `[0, 1]` at write time.
- **Descriptive snapshots are derived, never patched.** Personality rendered fields and user `communicationStyle`/`conflictStyle`/`preferredTone`/`interests` come from the AI snapshot; never from patches; never touch event-patched/runtime-derived user fields.
- **Append-and-flag only; no time decay.** Personality signals and political notes/positions are append-only; "removal" is a `status` change; reversibility comes only from later evidence.
- The live lane's `StatePatchApplicator.applyPatches` (Phase 3) keeps its behavior; this plan only *adds* `applyEvolutionPatches`.

## Concrete Phase 4 Decisions

### Personality signal store (separate table — decision 3)

`personality.add_signal` accumulates append-only signals in a new `bot_personality_signals` table. The rendered `botPersonalityStateSchema` is **unchanged** (no `signals` field).

```ts
interface PersonalitySignal {
  area: 'identity' | 'values' | 'speech_style' | 'social_habits' | 'themes';
  polarity: 'reinforce' | 'contest' | 'soften';
  text: string;
  evidenceMessageIds: number[];
  status: 'active' | 'contested' | 'inactive'; // always inserted 'active'; reconciliation is via polarity, not status flips
  createdAt: string;
}
```

The pass reconciles `reinforce`/`contest`/`soften` polarities when it derives the rendered personality snapshot; it never flips an existing signal row.

### Political compass (decision 1)

```ts
interface PoliticalCompass {
  economic: number;            // [-10, 10]  (- left, + right)
  social: number;              // [-10, 10]  (- libertarian, + authoritarian)
  economicConfidence: number;  // [0, 1]
  socialConfidence: number;    // [0, 1]
}
```

Neutral default: `{ economic: 0, social: 0, economicConfidence: 0, socialConfidence: 0 }`. The Zod schema uses bare `z.number()` (no `.min/.max`) so a slightly-off AI value never rejects the whole derived snapshot; the pass **clamps** axes to `[-10, 10]` and confidences to `[0, 1]` at write time (the spec's "re-enforced in validator/policy"). Compass is added to `botPoliticalStateSchema` (new `compass_json` column) and is the only new field rendered by `political_state_prompt.md` (it renders the whole political-state JSON).

### User political profile (decision 1)

```ts
interface PoliticalNote {
  text: string;
  evidenceMessageIds: number[];
  status: 'active' | 'contested' | 'inactive';
}
interface UserPoliticalProfile {
  userId: number;
  chatId: number;
  notes: PoliticalNote[];      // evidence-backed, append-only, contestable
  compass: PoliticalCompass;   // derived from active notes
  updatedAt: string;
}
```

Stored in a new `user_political_profiles` table (per user + chat), separate from `user_social_profiles`. Absent row → neutral center, no notes.

### `UserPoliticalPatch` (evolution lane)

Added to `evolutionPatchSchema`:

```ts
type UserPoliticalPatch =
  | { type: 'user.add_political_note'; userId: number; text: string; evidence: PatchEvidence }
  | { type: 'user.contest_political_note'; userId: number; target: { text: string }; evidence: PatchEvidence };
```

`user.contest_political_note` matches a note by `text`, appends counter-evidence, and flips `status` (`active → contested`, then `inactive`); notes are never deleted.

### Evolution AI contract (`StateEvolutionDecision`)

```ts
interface StateEvolutionDecision {
  evolutionPatches: EvolutionPatch[];      // personality.add_signal, politics.*, user.add_political_note, user.contest_political_note
  personalitySnapshot: {
    identityNotes: string[]; values: string[];
    speechStyle: { tone: string; humor: string; verbosity: 'short' | 'medium' | 'essay'; formality: 'low' | 'medium' | 'high' };
    socialHabits: string[]; recurringThemes: string[];
  };
  userSnapshots: Array<{ userId: number; communicationStyle: string; conflictStyle: string; preferredTone: string; interests: string[] }>;
  botCompass: PoliticalCompass;            // derived from positions[]
  userPoliticalSnapshots: Array<{ userId: number; compass: PoliticalCompass }>; // derived from each user's active notes
}
```

AI output is advisory: patches go through `PatchPolicy`; snapshots/compasses are validated for shape and written (clamped). A snapshot may reflect a policy-rejected patch — acceptable for v1 (noted as a risk).

### Confidence thresholds (resolves the tracker's open item)

Reuse the installed `DEFAULT_PATCH_POLICY_CONFIG` as the decided Phase-4 floors: `personalityMinConfidence 0.5` (below → reject), `politicalWeakMaxConfidence 0.4` (below → to-uncertainty), `politicalStrongMinConfidence 0.7` (strong/radical below → to-uncertainty), `radical` → policy `escalate`. User-political notes use the generic evidence + hard-boundary checks (no extra threshold).

### `applyEvolutionPatches` semantics

`applyEvolutionPatches({ chatId, patches, reviewedByStrongModel, nowIso? })` loads personality-signal target, political state, and any referenced user political profiles, applies every patch **independently and best-effort**, persists each mutated store **once**, and returns one `BehaviorPatchResult` per input patch in order. For each patch call `patchPolicy.evaluate(patch)` first, then:

- **`personality.add_signal`** — `reject` → `rejected`; `accept` → `personalitySignalRepo.add(chatId, { area, polarity, text, evidenceMessageIds: uniqueIds(evidence.messageIds), status: 'active', createdAt: nowIso })`; result `applied` (`stateRef { kind: 'bot_personality_signal', chatId }`).
- **`politics.add_uncertainty`** — `reject` → `rejected`; else append `"${topic}: ${summary}"` to `political.uncertaintyAreas` (de-duped); `applied` (`stateRef bot_political_state`).
- **`politics.add_position`** — `reject` → `rejected`; `to_uncertainty` → append `"${topic}: ${stance}"` to `uncertaintyAreas`, result `to_uncertainty`; `escalate` (radical): if `reviewedByStrongModel` → add radical position, else `escalated`; `accept` → add position at `requestedIntensity`. **Adding** appends `{ id: nextPositionId, topic, stance, intensity, confidence: clampConfidence(evidence.confidence), status: 'active', evidenceMessageIds: uniqueIds(evidence.messageIds), opposingEvidenceMessageIds: [], origin: 'chat_discussion', updatedAt: nowIso }` (`nextPositionId = Math.max(0, ...positions.map(p => p.id)) + 1`) and an `influenceHistory` entry `{ source: 'chat_discussion', summary: \`${topic}: ${stance}\`, evidenceMessageIds, confidence, createdAt: nowIso }`. Result `applied`.
- **`politics.adjust_position`** — `reject` → `rejected`; find by `positionId` with `status !== 'reversed'` (not found → `rejected` `target_not_found`); compute new intensity/status: `radicalize` → intensity one step up (`weak→moderate→strong→radical`), `status='active'`, merge evidence into `evidenceMessageIds`; `soften` → one step down, `status='softened'`, merge into `evidenceMessageIds`; `contest` → `status='contested'`, merge into `opposingEvidenceMessageIds`; `reverse` → `status='reversed'`, merge into `opposingEvidenceMessageIds`. **Radical-review gate:** if the resulting intensity is `radical` and `!reviewedByStrongModel` → `escalated`, do not mutate. Else set `updatedAt=nowIso`, append an influence entry, result `applied`.
- **`user.add_political_note`** — `reject` → `rejected`; else load/default the user political profile, append `{ text, evidenceMessageIds: uniqueIds(evidence.messageIds), status: 'active' }`, mark changed; `applied` (`stateRef { kind: 'user_political_profile', chatId, userId }`).
- **`user.contest_political_note`** — `reject` → `rejected`; find the latest non-`inactive` note by exact `text` (not found → `rejected` `target_not_found`); merge counter-evidence; flip `active→contested`, `contested→inactive`; `applied`.

Persist after the loop: personality signals are inserted as they apply; the political state upserts once if changed; each touched user political profile upserts once (set `updatedAt=nowIso`). `reviewedByStrongModel` is supplied by the pass as `result.metadata.escalated`. Evolution patches are **not** rate-limited.

### `BehaviorPatchOutcome` / `BehaviorPatchStateRef` additions

```ts
export type BehaviorPatchOutcome =
  | 'applied' | 'rejected' | 'rate_limited' | 'failed' | 'escalated' | 'to_uncertainty';

export type BehaviorPatchStateRef =
  | { kind: 'user_social_profile'; chatId: number; userId: number }
  | { kind: 'bot_truth'; chatId: number; truthId: number }
  | { kind: 'bot_personality_signal'; chatId: number }
  | { kind: 'bot_political_state'; chatId: number }
  | { kind: 'user_political_profile'; chatId: number; userId: number };
```

Purely additive; the live lane never produces the new variants.

### Cursor + triggering + worker + cadence

Identical to the original design (unchanged by the four decisions):

- Per-chat `state_evolution_cursors` row `{ chatId, lastEventId, lastRunAt }`.
- The pass treats only **live-lane** events (`modelSlot !== 'stateEvolution'`) as work, so it never self-triggers. Cursor advance on success = `max(maxReadEventId, loggedEvolutionEventId)` + `lastRunAt`; on "only stateEvolution events" → `maxReadEventId` + `lastRunAt`; on error → keep `lastEventId`, set `lastRunAt` (cooldown).
- Trigger (from the pipeline after a logged decision): `count(behavior_events since cursor) >= effectiveThreshold && cooldown elapsed`, where `effectiveThreshold = latestRisk === 'high' ? highRiskEventThreshold : eventThreshold`.
- Periodic floor: `cursorRepo.findChatsNeedingSweep(now - maxIntervalMs)` → `worker.requestRun(chatId)`.
- Single deduplicated worker per chat (mirrors the Phase 3 summarization dedupe and the future `chatId` concurrency key).

### Default config (`StateEvolutionConfig`)

```ts
{ enabled: true, eventThreshold: 8, highRiskEventThreshold: 3, cooldownMs: 5 * 60_000, maxIntervalMs: 60 * 60_000, recentMessageLimit: 60, sweepCron: '*/5 * * * *' }
```

## File Structure

**Schemas (`src/domain/behavior/schemas/`):**
- Create `evolution.ts` (decision contract + JSON schema). Modify `state.ts` (`personalitySignalSchema`, `politicalCompassSchema`, `compass` on `botPoliticalStateSchema`, `politicalNoteSchema`, `userPoliticalProfileSchema`), `patches.ts` (`userPoliticalPatchSchema` + into `evolutionPatchSchema`), `index.ts` (`export * from './evolution'`).

**Migration:** Create `migrations/016_state_evolution.up.sql` / `.down.sql` (`bot_personality_signals`, `state_evolution_cursors`, `compass_json` on `bot_political_states`, `user_political_profiles`).

**Entities/repositories:**
- Create `StateEvolutionCursorEntity.ts` + repo (interface + SQLite).
- Create `PersonalitySignalRepository.ts` + SQLite + a `NewPersonalitySignal` row.
- Create `UserPoliticalProfileRepository.ts` + SQLite.
- Modify `BehaviorEventRepository` + SQLite (`findByChatIdAfter`, `countByChatIdAfter`).
- Modify `SQLitePoliticalStateRepository` (read/write `compass_json`).

**Application services (`src/application/behavior/`):**
- Create `StateEvolutionContextAssembler` + Default, `StateEvolutionPass` + Default, `StateEvolutionWorker` + Default, `StateEvolutionTrigger` + Default, `StateEvolutionScheduler` + Default.
- Modify `BehaviorTypes.ts` (outcome/ref/`StateEvolutionContext`/`StateEvolutionResult`), `StatePatchApplicator` + Default (`applyEvolutionPatches`), `BehaviorAiService` + `ChatGPTService` (`proposeStateEvolution` + radical re-run), `BehaviorEventLogger` + Default (`logEvolution`), `BehaviorConfig.ts` (`StateEvolutionConfig`), `DefaultBehaviorPipeline.ts` (call trigger), `DefaultBehaviorContextAssembler.ts` (load user political profiles + `defaultPolitical` compass), `PatchPolicy` `DefaultPatchPolicy.ts` (`patchText` for user-political).

**Prompts + env:** Create `prompts/state_evolution_system_prompt.md`, `prompts/personality_signals_prompt.md`, `prompts/user_political_profiles_prompt.md`. Modify `political_state_prompt.md` (note: renders compass via the existing JSON block — no template change needed) and the env `PromptFiles` (interface + Default/Test). Modify `PromptBuilder` (`addStateEvolutionSystem`, `addPersonalitySignals`, `addUserPoliticalProfiles`), `PromptDirector` (`createStateEvolutionPrompt`, extend `createBehaviorDecisionPrompt`), `PromptTypes.ts` (`BehaviorPromptState.userPolitical`).

**DI:** Modify `src/container/repositories.ts`, `src/container/application.ts`.

**Tests (`test/`):** `behaviorMigration016`, `behaviorStateRepositories` (extend: political compass), `personalitySignalRepository`, `userPoliticalProfileRepository`, `stateEvolutionCursorRepository`, `behaviorEventRepositories` (extend), `behaviorEvolutionJsonSchema`, `StatePatchApplicatorEvolution`, `StateEvolutionPrompt`, `BehaviorPrompt` (extend: coordinates render), `ChatGPTService.stateEvolution`, `StateEvolutionContextAssembler`, `BehaviorContextAssembler` (extend: userPolitical), `BehaviorEventLogger` (extend), `StateEvolutionPass`, `StateEvolutionWorker`, `StateEvolutionTrigger`, `BehaviorPipeline` (extend), `StateEvolutionScheduler`, `container.behavior` (extend).

## Conventions (follow exactly)

No `any`/`@ts-`/default exports; pattern-matching over ternaries; `null` not `undefined`; `void` fire-and-forget; `pnpm lint:fix && pnpm format:fix` then `pnpm type:check` before each commit; single test via `pnpm test <path>`; repo tests build a temp SQLite DB inline. Migration `016` is the next number after `015`.

---

## Part A — Data and contracts

## Task 1: Migration 016

**Files:** `migrations/016_state_evolution.up.sql`, `.down.sql`; Test `test/behaviorMigration016.test.ts`.

- [ ] **Step 1: `016_state_evolution.up.sql`**

```sql
CREATE TABLE IF NOT EXISTS bot_personality_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  area TEXT NOT NULL,
  polarity TEXT NOT NULL,
  text TEXT NOT NULL,
  evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS state_evolution_cursors (
  chat_id INTEGER PRIMARY KEY,
  last_event_id INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS user_political_profiles (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  notes_json TEXT NOT NULL DEFAULT '[]',
  compass_json TEXT NOT NULL DEFAULT '{"economic":0,"social":0,"economicConfidence":0,"socialConfidence":0}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

ALTER TABLE bot_political_states ADD COLUMN compass_json TEXT NOT NULL DEFAULT '{"economic":0,"social":0,"economicConfidence":0,"socialConfidence":0}';

CREATE INDEX IF NOT EXISTS idx_bot_personality_signals_chat ON bot_personality_signals(chat_id, id);
```

- [ ] **Step 2: `016_state_evolution.down.sql`**

```sql
DROP INDEX IF EXISTS idx_bot_personality_signals_chat;
ALTER TABLE bot_political_states DROP COLUMN compass_json;
DROP TABLE IF EXISTS user_political_profiles;
DROP TABLE IF EXISTS state_evolution_cursors;
DROP TABLE IF EXISTS bot_personality_signals;
```

- [ ] **Step 3: Write `test/behaviorMigration016.test.ts`** — run `015` then `016` on a temp DB (FK targets `chats`/`users` created first); assert `bot_personality_signals`, `state_evolution_cursors`, `user_political_profiles` exist and `bot_political_states` has a `compass_json` column (`pragma_table_info`); assert `down` removes all four additions and leaves the `015` tables intact. (Mirror the existing `test/behaviorMigration015.test.ts` structure.)
- [ ] **Step 4: Run** — `pnpm test test/behaviorMigration016.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(behavior): add migration 016 for evolution, signals, and political coordinates`.

---

## Task 2: Schemas — compass, notes, signals, user-political patch

**Files:** `src/domain/behavior/schemas/state.ts`, `patches.ts`, `index.ts`; Test `test/behaviorJsonSchema.test.ts` (extend evolution-union invariant).

- [ ] **Step 1: Add to `state.ts`** (above `botPoliticalStateSchema`)

```typescript
export const personalitySignalSchema = z.object({
  area: z.enum(['identity', 'values', 'speech_style', 'social_habits', 'themes']),
  polarity: z.enum(['reinforce', 'contest', 'soften']),
  text: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  status: signalStatusSchema,
  createdAt: z.string(),
});

export const politicalCompassSchema = z.object({
  economic: z.number(),
  social: z.number(),
  economicConfidence: z.number(),
  socialConfidence: z.number(),
});

export const politicalNoteSchema = z.object({
  text: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  status: signalStatusSchema,
});

export const userPoliticalProfileSchema = z.object({
  userId: z.number().int(),
  chatId: z.number().int(),
  notes: z.array(politicalNoteSchema),
  compass: politicalCompassSchema,
  updatedAt: z.string(),
});
```

Add `compass: politicalCompassSchema` to `botPoliticalStateSchema` (after `influenceHistory`). Export `PersonalitySignal`, `PoliticalCompass`, `PoliticalNote`, `UserPoliticalProfile` types.

- [ ] **Step 2: Add to `patches.ts`** (after the user-profile patches)

```typescript
export const userAddPoliticalNotePatchSchema = z.object({
  type: z.literal('user.add_political_note'),
  userId: z.number().int(),
  text: z.string(),
  evidence: patchEvidenceSchema,
});
export const userContestPoliticalNotePatchSchema = z.object({
  type: z.literal('user.contest_political_note'),
  userId: z.number().int(),
  target: z.object({ text: z.string() }),
  evidence: patchEvidenceSchema,
});
export const userPoliticalPatchSchema = z.discriminatedUnion('type', [
  userAddPoliticalNotePatchSchema,
  userContestPoliticalNotePatchSchema,
]);
```

Extend `evolutionPatchSchema` to include `userAddPoliticalNotePatchSchema` and `userContestPoliticalNotePatchSchema`. Export `UserPoliticalPatch = z.infer<typeof userPoliticalPatchSchema>`.

- [ ] **Step 3: `index.ts`** already re-exports `state`/`patches`; no change needed beyond Task 5's `evolution` export.

- [ ] **Step 4: Extend `test/behaviorJsonSchema.test.ts`** — no live-schema change (these are evolution-lane only). The evolution union's strict-compatibility is asserted in Task 5's `behaviorEvolutionJsonSchema.test.ts`; here only confirm the existing decision/gate tests still pass.

- [ ] **Step 5: Run** — `pnpm test test/behaviorJsonSchema.test.ts` and `pnpm type:check` → PASS (type-check surfaces every `BotPoliticalState` constructor missing `compass`; fix in Task 3).
- [ ] **Step 6: Commit** — `feat(behavior): add compass, political notes, personality signal, and user-political patch schemas`.

---

## Task 3: Political state compass — repo + default sites

**Files:** `SQLitePoliticalStateRepository.ts`, `DefaultBehaviorContextAssembler.ts` (`defaultPolitical`), `test/behaviorStateRepositories.test.ts`.

- [ ] **Step 1: Extend the failing political round-trip test** — add `compass: { economic: 3, social: -2, economicConfidence: 0.4, socialConfidence: 0.3 }` to the political `upsert` and assert it round-trips; add `compass: { economic: 0, social: 0, economicConfidence: 0, socialConfidence: 0 }` to the "malformed stored position" political `upsert` so writes still parse.
- [ ] **Step 2: Run to verify failure** (`compass` missing / column unknown).
- [ ] **Step 3: Extend `SQLitePoliticalStateRepository`** — add `compass_json` to the row type, `SELECT`, parse object (`compass: JSON.parse(row.compass_json)`), and `INSERT`/`ON CONFLICT` (`compass_json=excluded.compass_json`, bind `JSON.stringify(state.compass)`).
- [ ] **Step 4: Update `defaultPolitical` in `DefaultBehaviorContextAssembler`** — add `compass: { economic: 0, social: 0, economicConfidence: 0, socialConfidence: 0 }`.
- [ ] **Step 5: Run** — `pnpm test test/behaviorStateRepositories.test.ts` → PASS, then `pnpm type:check` (fix any other `BotPoliticalState` site, e.g. a `defaultPolitical` in the applicator added later).
- [ ] **Step 6: Commit** — `feat(behavior): persist the bot political compass`.

---

## Task 4: PersonalitySignalRepository

**Files:** `src/domain/repositories/PersonalitySignalRepository.ts`, `SQLitePersonalitySignalRepository.ts`; Test `test/personalitySignalRepository.test.ts`.

- [ ] **Step 1: Interface**

```typescript
import type { ServiceIdentifier } from 'inversify';
import type { PersonalitySignal } from '@/domain/behavior/schemas/state';

export type NewPersonalitySignal = PersonalitySignal & { chatId: number };

export interface PersonalitySignalRepository {
  add(signal: NewPersonalitySignal): Promise<number>;
  findByChatId(chatId: number): Promise<PersonalitySignal[]>;
}

export const PERSONALITY_SIGNAL_REPOSITORY_ID = Symbol.for(
  'PersonalitySignalRepository'
) as ServiceIdentifier<PersonalitySignalRepository>;
```

- [ ] **Step 2: Failing test** — temp DB (`015`+`016`), insert two signals for a chat, assert `findByChatId` returns them ordered by id and parses `evidence_message_ids_json`; assert a corrupt `status` row rejects on read (`personalitySignalSchema.parse`). Mirror `behaviorStateRepositories.test.ts` setup.
- [ ] **Step 3: `SQLitePersonalitySignalRepository`** — `add` inserts (`chat_id, area, polarity, text, evidence_message_ids_json, status, created_at`) and returns `lastID`; `findByChatId` selects ordered by `id` and maps each row through `personalitySignalSchema.parse({ area, polarity, text, evidenceMessageIds: JSON.parse(...), status, createdAt })`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(behavior): add append-only personality signal repository`.

---

## Task 5: UserPoliticalProfileRepository

**Files:** `src/domain/repositories/UserPoliticalProfileRepository.ts`, `SQLiteUserPoliticalProfileRepository.ts`; Test `test/userPoliticalProfileRepository.test.ts`.

- [ ] **Step 1: Interface** (mirror `UserSocialProfileRepository`)

```typescript
import type { ServiceIdentifier } from 'inversify';
import type { UserPoliticalProfile } from '@/domain/behavior/schemas/state';

export interface UserPoliticalProfileRepository {
  findByChatAndUser(chatId: number, userId: number): Promise<UserPoliticalProfile | undefined>;
  findByChat(chatId: number): Promise<UserPoliticalProfile[]>;
  upsert(profile: UserPoliticalProfile): Promise<void>;
}

export const USER_POLITICAL_PROFILE_REPOSITORY_ID = Symbol.for(
  'UserPoliticalProfileRepository'
) as ServiceIdentifier<UserPoliticalProfileRepository>;
```

- [ ] **Step 2: Failing test** — round-trip a profile with notes + compass; `findByChatAndUser` undefined when missing; `findByChat` count; reject a row whose stored `notes_json` is malformed (`userPoliticalProfileSchema.parse`).
- [ ] **Step 3: `SQLiteUserPoliticalProfileRepository`** — `findByChatAndUser`/`findByChat` parse `notes_json`/`compass_json` via `userPoliticalProfileSchema.parse`; `upsert` `INSERT ... ON CONFLICT(chat_id, user_id) DO UPDATE SET notes_json=..., compass_json=..., updated_at=...`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(behavior): add user political profile repository`.

---

## Task 6: BehaviorEventRepository delta queries

**Files:** `BehaviorEventRepository.ts`, `SQLiteBehaviorEventRepository.ts`; Test `test/behaviorEventRepositories.test.ts`.

- [ ] **Step 1:** add `findByChatIdAfter(chatId, afterId): Promise<BehaviorEventEntity[]>` and `countByChatIdAfter(chatId, afterId): Promise<number>` to the interface.
- [ ] **Step 2: Failing tests** — insert several events; assert `findByChatIdAfter(chatId, k)` returns only `id > k` ordered by id and `countByChatIdAfter` matches.
- [ ] **Step 3: Implement** —

```typescript
async findByChatIdAfter(chatId: number, afterId: number): Promise<BehaviorEventEntity[]> {
  const db = await this.dbProvider.get();
  const rows = await db.all<BehaviorEventRow>('SELECT * FROM behavior_events WHERE chat_id = ? AND id > ? ORDER BY id', chatId, afterId);
  return rows.map(toEntity);
}
async countByChatIdAfter(chatId: number, afterId: number): Promise<number> {
  const db = await this.dbProvider.get();
  const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM behavior_events WHERE chat_id = ? AND id > ?', chatId, afterId);
  return row?.n ?? 0;
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(behavior): add behavior_events delta queries`.

---

## Task 7: State-evolution cursor entity + repository

**Files:** `StateEvolutionCursorEntity.ts`, `StateEvolutionCursorRepository.ts`, `SQLiteStateEvolutionCursorRepository.ts`; Test `test/stateEvolutionCursorRepository.test.ts`.

- [ ] **Step 1: Entity** — `interface StateEvolutionCursor { chatId: number; lastEventId: number; lastRunAt: string | null }`.
- [ ] **Step 2: Interface** — `get(chatId)`, `upsert(cursor)`, `findChatsNeedingSweep(notRunSinceIso): Promise<number[]>` + `STATE_EVOLUTION_CURSOR_REPOSITORY_ID`.
- [ ] **Step 3: Failing test** — round-trip get/upsert; undefined when missing; `findChatsNeedingSweep` returns a chat with events beyond its cursor and a null/stale `last_run_at`, excludes a caught-up + recently-run chat. (Insert behavior_events rows directly; mirror Task earlier-shown SQL in the previous revision.)
- [ ] **Step 4: Implement `SQLiteStateEvolutionCursorRepository`** —

```typescript
async findChatsNeedingSweep(notRunSinceIso: string): Promise<number[]> {
  const db = await this.dbProvider.get();
  const rows = await db.all<{ chat_id: number }>(
    `SELECT be.chat_id AS chat_id FROM behavior_events be
     LEFT JOIN state_evolution_cursors c ON c.chat_id = be.chat_id
     WHERE be.id > COALESCE(c.last_event_id, 0)
     GROUP BY be.chat_id
     HAVING c.last_run_at IS NULL OR c.last_run_at <= ?`,
    notRunSinceIso
  );
  return rows.map((r) => r.chat_id);
}
```

plus `get` (parse to `{ chatId, lastEventId, lastRunAt }`) and `upsert` (`ON CONFLICT(chat_id) DO UPDATE SET last_event_id=excluded.last_event_id, last_run_at=excluded.last_run_at`).

- [ ] **Step 5: Run** → PASS. **Step 6: Commit** — `feat(behavior): add state evolution cursor repository`.

---

## Task 8: Evolution AI contract (`evolution.ts`)

**Files:** Create `src/domain/behavior/schemas/evolution.ts`; modify `index.ts`; Test `test/behaviorEvolutionJsonSchema.test.ts`.

- [ ] **Step 1: `evolution.ts`**

```typescript
import { z } from 'zod';

import { toOpenAiJsonSchema } from './jsonSchema';
import { evolutionPatchSchema } from './patches';
import { messageIdSchema } from './primitives';
import { politicalCompassSchema, speechStyleSchema } from './state';

export const personalitySnapshotSchema = z.object({
  identityNotes: z.array(z.string()),
  values: z.array(z.string()),
  speechStyle: speechStyleSchema,
  socialHabits: z.array(z.string()),
  recurringThemes: z.array(z.string()),
});

export const userProfileSnapshotSchema = z.object({
  userId: messageIdSchema,
  communicationStyle: z.string(),
  conflictStyle: z.string(),
  preferredTone: z.string(),
  interests: z.array(z.string()),
});

export const userCompassSnapshotSchema = z.object({
  userId: messageIdSchema,
  compass: politicalCompassSchema,
});

export const stateEvolutionDecisionSchema = z.object({
  evolutionPatches: z.array(evolutionPatchSchema),
  personalitySnapshot: personalitySnapshotSchema,
  userSnapshots: z.array(userProfileSnapshotSchema),
  botCompass: politicalCompassSchema,
  userPoliticalSnapshots: z.array(userCompassSnapshotSchema),
});

export const stateEvolutionJsonSchema = toOpenAiJsonSchema(
  stateEvolutionDecisionSchema,
  'StateEvolutionDecision'
);

export type PersonalitySnapshot = z.infer<typeof personalitySnapshotSchema>;
export type UserProfileSnapshot = z.infer<typeof userProfileSnapshotSchema>;
export type UserCompassSnapshot = z.infer<typeof userCompassSnapshotSchema>;
export type StateEvolutionDecision = z.infer<typeof stateEvolutionDecisionSchema>;
```

- [ ] **Step 2:** add `export * from './evolution';` to `index.ts` (after `./state`).
- [ ] **Step 3: Failing test** (`behaviorEvolutionJsonSchema.test.ts`) — reuse the whole-tree `assertStrict` invariant from `test/behaviorJsonSchema.test.ts` against `stateEvolutionJsonSchema.schema`; assert `name === 'StateEvolutionDecision'`, `strict === true`. (This also proves the now-larger `evolutionPatchSchema` discriminated union, including the user-political variants, normalizes to strict-compatible `anyOf`.)
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(behavior): add state evolution decision schema and JSON schema`.

---

## Part B — Application services

## Task 9: PatchPolicy — user-political patch text

**Files:** `DefaultPatchPolicy.ts`; Test `test/PatchPolicy.test.ts` (extend).

- [ ] **Step 1: Failing tests** — `user.add_political_note` with empty `evidence.messageIds` → `reject` (`missing evidence`); with a hard-boundary term in `text` → `reject`; otherwise → `accept`; `user.contest_political_note` matches on `target.text` for the boundary check.
- [ ] **Step 2: Extend `patchText`** — add `case 'user.add_political_note': return patch.text;` and `case 'user.contest_political_note': return patch.target.text;`. The generic evidence + boundary checks (already at the top of `evaluate`) then cover these patches; the `switch` `default` returns `accept`.
- [ ] **Step 3: Run** → PASS. **Step 4: Commit** — `feat(behavior): extend patch policy to user political notes`.

---

## Task 10: `StatePatchApplicator.applyEvolutionPatches`

**Files:** `BehaviorTypes.ts`, `StatePatchApplicator.ts`, `DefaultStatePatchApplicator.ts`; Test `test/StatePatchApplicatorEvolution.test.ts`.

- [ ] **Step 1:** apply the `BehaviorPatchOutcome` / `BehaviorPatchStateRef` additions to `BehaviorTypes.ts`.
- [ ] **Step 2:** add `applyEvolutionPatches({ chatId, patches: readonly EvolutionPatch[], reviewedByStrongModel: boolean, nowIso?: string }): Promise<BehaviorPatchResult[]>` to the interface.
- [ ] **Step 3: Failing tests** — stub `PersonalitySignalRepository`, `PoliticalStateRepository`, `UserPoliticalProfileRepository` (+ the existing live deps), use real `DefaultPatchPolicy`. Cover every rule in "Concrete Phase 4 Decisions → `applyEvolutionPatches` semantics": personality signal accept/reject (writes through the signal repo); political add (id generation continues from max, influence appended), to-uncertainty, radical gate (add + adjust) on `reviewedByStrongModel`, contest/reverse status flags without deletion, `target_not_found`; `user.add_political_note` appends a note; `user.contest_political_note` flips `active→contested→inactive` and `target_not_found`; best-effort independence (a rejected patch leaves a sibling applied).
- [ ] **Step 4: Implement** — extend the constructor with `@inject(PERSONALITY_SIGNAL_REPOSITORY_ID)`, `@inject(POLITICAL_STATE_REPOSITORY_ID)`, `@inject(USER_POLITICAL_PROFILE_REPOSITORY_ID)`. Implement `applyEvolutionPatches`: load political state once (lazy `defaultPolitical` with neutral compass), group user-political patches by `userId` (load each profile once, lazy neutral default), append personality signals through the repo as they apply, mutate political/profiles per the rules, and upsert each mutated store once. Use `switch` over `patch.type` and `policy.outcome`; reuse `uniqueIds`/`clampConfidence`; add `stepIntensityUp`/`stepIntensityDown` (switch maps), `nextPositionId`, `pushUncertainty` (de-dup), `contestNote`, and `applied*`/`rejected*` helpers.
- [ ] **Step 5: Run** — `pnpm test test/StatePatchApplicatorEvolution.test.ts` then `pnpm test test/StatePatchApplicator.test.ts` (no live regression) → PASS.
- [ ] **Step 6: Commit** — `feat(behavior): apply personality, political, and user-political evolution patches`.

---

## Task 11: Prompts + env + director flows

**Files:** `prompts/state_evolution_system_prompt.md`, `prompts/personality_signals_prompt.md`, `prompts/user_political_profiles_prompt.md`; `EnvService.ts` + `DefaultEnvService.ts` + `TestEnvService.ts`; `PromptBuilder.ts`; `PromptTypes.ts`; `PromptDirector.ts`; `BehaviorTypes.ts` (`StateEvolutionContext`); Tests `test/StateEvolutionPrompt.test.ts`, `test/BehaviorPrompt.test.ts` (or extend the existing director/builder test).

- [ ] **Step 1: Write the three prompt files.** `state_evolution_system_prompt.md`: slow reflective reconciliation; propose only `personality.add_signal`, `politics.*`, `user.add_political_note`, `user.contest_political_note`, each with evidence; weak political → uncertainty; hard safety floor; personality append-only (reconcile polarities in the derived snapshot); derive `personalitySnapshot`, `userSnapshots`, `botCompass` (from positions, axes `[-10,10]`, confidence `[0,1]`), and `userPoliticalSnapshots` (each user's compass from their active notes); output matches the `StateEvolutionDecision` schema. `personality_signals_prompt.md`: `Accumulated personality signals:\n\n{{personalitySignalsJson}}`. `user_political_profiles_prompt.md`: `User political profiles (compass + active notes):\n\n{{userPoliticalProfilesJson}}`.
- [ ] **Step 2: Register prompt files** — add `stateEvolutionSystem`, `personalitySignals`, `userPoliticalProfiles` to `PromptFiles` (interface) and both env services (`prompts/state_evolution_system_prompt.md`, etc.). `PromptTemplateName = keyof PromptFiles` updates automatically.
- [ ] **Step 3: `PromptTypes.ts`** — add `userPolitical: UserPoliticalProfile[]` to `BehaviorPromptState`.
- [ ] **Step 4: `PromptBuilder`** — add `addStateEvolutionSystem()` (mirror `addBehaviorDecisionSystem`), `addPersonalitySignals(signals: PersonalitySignal[])` (`{{personalitySignalsJson}}` ← `stringify`), `addUserPoliticalProfiles(profiles: UserPoliticalProfile[])` (`{{userPoliticalProfilesJson}}` ← `stringify`).
- [ ] **Step 5: `BehaviorTypes.ts`** — `StateEvolutionContext`:

```typescript
import type { StateImpactRisk } from '@/domain/behavior/schemas/primitives';
import type { PersonalitySignal } from '@/domain/behavior/schemas/state';

export interface StateEvolutionContext extends BehaviorPromptContext {
  chatId: number;
  maxStateImpactRisk: StateImpactRisk;
  personalitySignals: PersonalitySignal[];
}
```

- [ ] **Step 6: `PromptDirector`** — extend `createBehaviorDecisionPrompt` to render coordinates context-only: after `.addUserProfiles(context.state.profiles)` add `.addUserPoliticalProfiles(context.state.userPolitical)` (the bot compass already renders inside `addPoliticalState`'s JSON). Add `createStateEvolutionPrompt(context: StateEvolutionContext)`:

```typescript
async createStateEvolutionPrompt(context: StateEvolutionContext): Promise<PromptMessage[]> {
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
    .addBehaviorMessages(context.messages)
    .build();
}
```

- [ ] **Step 7: Tests** — `StateEvolutionPrompt.test.ts`: assert the evolution prompt includes the system text, personality state + signals, political state + compass JSON, user social + political profiles, truths, and messages. Extend the existing behavior-decision prompt test to assert user political profiles render in `createBehaviorDecisionPrompt`.
- [ ] **Step 8: Run** the two prompt tests → PASS. **Step 9: Commit** — `feat(behavior): render coordinates and add the state evolution prompt flow`.

---

## Task 12: `proposeStateEvolution` (with radical re-run)

**Files:** `BehaviorAiService.ts`, `BehaviorTypes.ts` (`StateEvolutionResult`), `ChatGPTService.ts`; Test `test/ChatGPTService.stateEvolution.test.ts`.

- [ ] **Step 1:** add `StateEvolutionResult { decision: StateEvolutionDecision; metadata: AiCallMetadata }` to `BehaviorTypes.ts`; add `proposeStateEvolution(context: StateEvolutionContext): Promise<StateEvolutionResult>` to the interface.
- [ ] **Step 2: Failing tests** — mock `openai.chat.completions.parse`. Assert: `maxStateImpactRisk: 'high'` starts on the escalation model (`escalated`, `selectedModel: 'gpt-5.5'`, `modelSlot: 'stateEvolution'`); non-high starts on default; a proposal containing a `politics.add_position` `requestedIntensity: 'radical'` **on the default model re-runs on the escalation model** (decision 2); schema-parse failure on default re-runs on escalation; request uses `zodResponseFormat(stateEvolutionDecisionSchema, 'StateEvolutionDecision')`.
- [ ] **Step 3: Implement** — add `stateEvolutionModel`/`stateEvolutionEscalationModel` from `models.stateEvolution`; widen `buildMetadata`'s `escalationReason` param to `string | null`. The `attempt` loop mirrors `decideBehavior`: parse → if `raw == null` or `safeParse` fails and not on escalation model, re-attempt on escalation; **also** `if (hasRadicalPatch(parsed.data) && model !== escalationModel) return attempt(escalationModel, true, 'radical_review')`. `hasRadicalPatch` = any patch with `type === 'politics.add_position' && requestedIntensity === 'radical'` or `type === 'politics.adjust_position' && direction === 'radicalize'`. Initial model + `escalated` from `maxStateImpactRisk === 'high'`.
- [ ] **Step 4: Run** — `pnpm test test/ChatGPTService.stateEvolution.test.ts` + re-run `test/ChatGPTService.behavior.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(behavior): add proposeStateEvolution with radical-review escalation`.

---

## Task 13: State-evolution context assembler + config

**Files:** `BehaviorConfig.ts` (`StateEvolutionConfig`), `StateEvolutionContextAssembler.ts` + Default; Test `test/StateEvolutionContextAssembler.test.ts`.

- [ ] **Step 1: `StateEvolutionConfig`** + `DEFAULT_STATE_EVOLUTION_CONFIG` (decision 4 defaults) + `STATE_EVOLUTION_CONFIG_ID` in `BehaviorConfig.ts`.
- [ ] **Step 2: Interface** — `assemble({ chatId, events: readonly BehaviorEventEntity[] }): Promise<StateEvolutionContext>` + `STATE_EVOLUTION_CONTEXT_ASSEMBLER_ID`.
- [ ] **Step 3: Failing tests** — stub `MessageService`, `SummaryService`, personality/political/social-profile/truth repos + the new `PersonalitySignalRepository` + `UserPoliticalProfileRepository`. Assert the context loads the recent window + referenced ids (merged, de-duped, id-sorted), current state (personality, political w/ compass, social profiles, user political profiles, truths), personality signals, summary, `maxStateImpactRisk` (max over events' `gateStateImpactRisk`), and empty marker arrays.
- [ ] **Step 4: Implement `DefaultStateEvolutionContextAssembler`** — derive `selectedIds` from each event's `triggerMessageIdsJson`/`contextMessageIdsJson`; load messages (recent + by ids), summary, the four state repos (defaults if absent, political default with neutral compass), `personalitySignalRepo.findByChatId`, `userPoliticalRepo.findByChat`; compute `maxStateImpactRisk` over `none<low<medium<high`; return `{ chatId, maxStateImpactRisk, summary, messages, triggerMessageIds: [], contextMessageIds: [], batchMessageIds: [], personalitySignals, state: { personality, political, profiles, userPolitical, truths } }`.
- [ ] **Step 5: Run** → PASS. **Step 6: Commit** — `feat(behavior): assemble the state evolution context`.

> Also update `DefaultBehaviorContextAssembler` (live lane) to populate `state.userPolitical` (inject `USER_POLITICAL_PROFILE_REPOSITORY_ID`, `findByChat`) so the live decision prompt renders coordinates. Extend `test/BehaviorContextAssembler.test.ts` accordingly. Do this in this task and include it in the commit.

---

## Task 14: `BehaviorEventLogger.logEvolution`

**Files:** `BehaviorEventLogger.ts`, `DefaultBehaviorEventLogger.ts`; Test `test/BehaviorEventLogger.test.ts`.

- [ ] **Step 1:** add `logEvolution({ chatId, result: StateEvolutionResult, patchResults: BehaviorPatchResult[], maxStateImpactRisk: StateImpactRisk }): Promise<number>` to the interface.
- [ ] **Step 2: Failing tests** — assert the inserted row has `modelSlot: 'stateEvolution'`, `actionsJson: '[]'`, `actionResultsJson: '[]'`, `statePatchesJson` = `decision.evolutionPatches`, `patchResultsJson` = the patch results, `gateReason: null`, `gateStateImpactRisk` = the risk, `confidence: 0`, tokens/latency from metadata.
- [ ] **Step 3: Implement** `logEvolution` (insert with the fields above; `triggerMessageIdsJson`/`contextMessageIdsJson` = `'[]'`; `createdAt = new Date().toISOString()`).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(behavior): log state evolution passes to behavior_events`.

---

## Task 15: `StateEvolutionPass` orchestration

**Files:** `StateEvolutionPass.ts` + Default; Test `test/StateEvolutionPass.test.ts`.

- [ ] **Step 1: Interface** — `run(chatId): Promise<StateEvolutionRunResult>` where `StateEvolutionRunResult = { kind: 'skipped' } | { kind: 'error'; errorEventId: number } | { kind: 'evolved'; behaviorEventId: number; patchResults: BehaviorPatchResult[] }` + `STATE_EVOLUTION_PASS_ID`.
- [ ] **Step 2: Failing tests** — stub cursor repo, event repo (`findByChatIdAfter`), context assembler, `proposeStateEvolution`, `applyEvolutionPatches`, personality-state repo, social-profile repo, **political-state repo**, **user-political repo**, event logger (`logEvolution`), error logger. Cover:
  - **No live events** (only a `stateEvolution`-slot row since cursor) → `skipped`; cursor advances `lastEventId` to that id + `lastRunAt`; AI not called.
  - **Happy path** → `applyEvolutionPatches` called with `reviewedByStrongModel = metadata.escalated`; writes personality snapshot (rendered fields), **bot compass** (clamped onto the political state), each user descriptive snapshot (only descriptive fields on the social profile), and each **user compass** (clamped onto the user political profile); logs the event; advances cursor to the logged id; returns `evolved`.
  - **Clamping** — a `botCompass.economic: 99` is written as `10`; a `socialConfidence: -1` is written as `0`.
  - **User snapshot isolation** — seed a social profile with `affinityScore`/`labels`/`grudges`; after a snapshot write those are unchanged.
  - **AI throws** → `AiErrorLogger.log`, `kind: 'error'`, keeps `lastEventId`, sets `lastRunAt` (cooldown).
- [ ] **Step 3: Implement `DefaultStateEvolutionPass`** per "Concrete Phase 4 Decisions → Cursor + triggering". Inject cursor repo, event repo, context assembler, `BEHAVIOR_AI_SERVICE_ID`, `STATE_PATCH_APPLICATOR_ID`, `PERSONALITY_STATE_REPOSITORY_ID`, `POLITICAL_STATE_REPOSITORY_ID`, `USER_SOCIAL_PROFILE_REPOSITORY_ID`, `USER_POLITICAL_PROFILE_REPOSITORY_ID`, `BEHAVIOR_EVENT_LOGGER_ID`, `AI_ERROR_LOGGER_ID`, `LOGGER_FACTORY_ID`. Algorithm:

```
cursor = (await cursorRepo.get(chatId)) ?? { chatId, lastEventId: 0, lastRunAt: null };
allNew = await eventRepo.findByChatIdAfter(chatId, cursor.lastEventId);
liveNew = allNew.filter((e) => e.modelSlot !== 'stateEvolution');
maxReadEventId = allNew.reduce((m, e) => Math.max(m, e.id), cursor.lastEventId);
nowIso = new Date().toISOString();
if (liveNew.length === 0) { await cursorRepo.upsert({ chatId, lastEventId: maxReadEventId, lastRunAt: nowIso }); return { kind: 'skipped' }; }

try { context = await assembler.assemble({ chatId, events: liveNew }); result = await ai.proposeStateEvolution(context); }
catch (error) { errorEventId = await errorLogger.log({ chatId, source: 'state_evolution_openai', ... }); await cursorRepo.upsert({ chatId, lastEventId: cursor.lastEventId, lastRunAt: nowIso }); return { kind: 'error', errorEventId }; }

reviewedByStrongModel = result.metadata.escalated;
patchResults = await applicator.applyEvolutionPatches({ chatId, patches: result.decision.evolutionPatches, reviewedByStrongModel, nowIso });

await this.writePersonalitySnapshot(chatId, result.decision.personalitySnapshot, nowIso);
await this.writeBotCompass(chatId, result.decision.botCompass, nowIso);
await this.writeUserSnapshots(chatId, result.decision.userSnapshots, nowIso);
await this.writeUserCompasses(chatId, result.decision.userPoliticalSnapshots, nowIso);

behaviorEventId = await eventLogger.logEvolution({ chatId, result, patchResults, maxStateImpactRisk: context.maxStateImpactRisk });
await cursorRepo.upsert({ chatId, lastEventId: Math.max(maxReadEventId, behaviorEventId), lastRunAt: nowIso });
return { kind: 'evolved', behaviorEventId, patchResults };
```

`writePersonalitySnapshot` loads/defaults the personality state, overwrites the five rendered fields + `lastUpdatedAt`, upserts. `writeBotCompass` loads/defaults the political state, sets `compass = clampCompass(botCompass)` + `lastUpdatedAt`, upserts. `writeUserSnapshots` loads/defaults each social profile (mirror Phase 3 `defaultProfile`), sets only the four descriptive fields + `updatedAt`. `writeUserCompasses` loads/defaults each user political profile, sets `compass = clampCompass(...)` + `updatedAt`. `clampCompass` clamps axes to `[-10, 10]`, confidences to `[0, 1]`.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(behavior): orchestrate the background state evolution pass`.

---

## Task 16: `StateEvolutionWorker`

**Files:** `StateEvolutionWorker.ts` + Default; Test `test/StateEvolutionWorker.test.ts`.

- [ ] **Step 1: Interface** — `requestRun(chatId: number): void` + `STATE_EVOLUTION_WORKER_ID`.
- [ ] **Step 2: Failing tests** — deferred `pass.run`; one run starts once; in-flight requests don't start a second run; exactly one rerun after completion if requested during the run; a throwing `pass.run` is caught and the next `requestRun` runs again.
- [ ] **Step 3: Implement `DefaultStateEvolutionWorker`** — per-chat `{ running, rerun }` map; `requestRun` sets `rerun` if running else starts `drain`; `drain` awaits `pass.run` (try/catch + logger), loops if `rerun`, else clears the entry.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(behavior): add deduplicated per-chat state evolution worker`.

---

## Task 17: `StateEvolutionTrigger` + pipeline integration

**Files:** `StateEvolutionTrigger.ts` + Default; `DefaultBehaviorPipeline.ts`; Tests `test/StateEvolutionTrigger.test.ts`, `test/BehaviorPipeline.test.ts`.

- [ ] **Step 1: Interface** — `maybeSchedule(chatId: number, latestRisk: StateImpactRisk): Promise<void>` + `STATE_EVOLUTION_TRIGGER_ID`.
- [ ] **Step 2: Failing tests** — stub cursor repo, event repo (`countByChatIdAfter`), worker; `DEFAULT_STATE_EVOLUTION_CONFIG`. Cover: count ≥ 8 + cooldown elapsed → requests; count 3–7 + `latestRisk: 'high'` → requests; count ≥ threshold but recent `lastRunAt` → no request; `enabled: false` → never; missing cursor → `lastEventId 0`, `lastRunAt null` (cooldown satisfied).
- [ ] **Step 3: Implement `DefaultStateEvolutionTrigger`** (config, cursor repo, event repo, worker) — per "Concrete Phase 4 Decisions → Cursor + triggering".
- [ ] **Step 4: Wire into `DefaultBehaviorPipeline`** — inject `STATE_EVOLUTION_TRIGGER_ID`; after `eventLogger.logDecision(...)` in `decide(...)`, `void this.evolutionTrigger.maybeSchedule(chatId, gate.stateImpactRisk).catch((error) => this.logger.error({ error, chatId }, 'State evolution trigger failed'))`.
- [ ] **Step 5: Extend `test/BehaviorPipeline.test.ts`** — add the trigger stub to the pipeline construction and assert `maybeSchedule(chatId, gate.stateImpactRisk)` is called once after a `decided` result.
- [ ] **Step 6: Run** the two tests → PASS. **Step 7: Commit** — `feat(behavior): trigger state evolution from the pipeline`.

---

## Task 18: `StateEvolutionScheduler`

**Files:** `StateEvolutionScheduler.ts` + Default; Test `test/StateEvolutionScheduler.test.ts`.

- [ ] **Step 1: Interface** — `start(): void`, `stop(): void`, `sweep(): Promise<void>` + `STATE_EVOLUTION_SCHEDULER_ID`.
- [ ] **Step 2: Failing tests** — call `sweep()` directly (no cron in tests); stub `findChatsNeedingSweep` → `[1, 2]`, assert `worker.requestRun` per chat; `enabled: false` → no requests; assert `findChatsNeedingSweep` called with an ISO `≈ now - maxIntervalMs`.
- [ ] **Step 3: Implement `DefaultStateEvolutionScheduler`** (mirror `TopicOfDaySchedulerImpl`'s `node-cron`) — `start` guards on `enabled`/already-started and `cron.schedule(config.sweepCron, () => void this.sweep())`; `stop` stops the task; `sweep` computes `notRunSince = new Date(Date.now() - config.maxIntervalMs).toISOString()`, requests a run per returned chat, try/catch + logger.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(behavior): add periodic state evolution sweep scheduler`.

> Phase 4 does not call `start()`; only binding + `sweep()` are tested. `start()` wiring into bootstrap is deferred to Phase 5 alongside the live-pipeline cutover.

---

## Task 19: DI wiring + container test

**Files:** `src/container/repositories.ts`, `src/container/application.ts`; Test `test/container.behavior.test.ts`.

- [ ] **Step 1: `repositories.ts`** — bind `STATE_EVOLUTION_CURSOR_REPOSITORY_ID → SQLiteStateEvolutionCursorRepository`, `PERSONALITY_SIGNAL_REPOSITORY_ID → SQLitePersonalitySignalRepository`, `USER_POLITICAL_PROFILE_REPOSITORY_ID → SQLiteUserPoliticalProfileRepository` (singletons).
- [ ] **Step 2: `application.ts`** — `toConstantValue(DEFAULT_STATE_EVOLUTION_CONFIG)`; bind the context assembler, pass, worker, trigger, scheduler (singletons). (`BEHAVIOR_AI_SERVICE_ID → ChatGPTService` already covers `proposeStateEvolution`.)
- [ ] **Step 3: Extend `test/container.behavior.test.ts`** — resolve and assert defined: pass, worker, trigger, scheduler, context assembler, cursor repo, personality-signal repo, user-political repo.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `feat(behavior): wire state evolution and coordinates into the container`.

---

## Verification

- [ ] **Focused Phase 4 tests:**

```bash
pnpm test test/behaviorMigration016.test.ts test/behaviorStateRepositories.test.ts test/personalitySignalRepository.test.ts test/userPoliticalProfileRepository.test.ts test/stateEvolutionCursorRepository.test.ts test/behaviorEventRepositories.test.ts test/behaviorEvolutionJsonSchema.test.ts test/PatchPolicy.test.ts test/StatePatchApplicatorEvolution.test.ts test/StateEvolutionPrompt.test.ts test/ChatGPTService.stateEvolution.test.ts test/StateEvolutionContextAssembler.test.ts test/BehaviorContextAssembler.test.ts test/BehaviorEventLogger.test.ts test/StateEvolutionPass.test.ts test/StateEvolutionWorker.test.ts test/StateEvolutionTrigger.test.ts test/StateEvolutionScheduler.test.ts test/BehaviorPipeline.test.ts test/container.behavior.test.ts
```

- [ ] **Full project checks:**

```bash
pnpm test
pnpm type:check
pnpm lint:fix
pnpm format:fix
pnpm build
```

- [ ] `.env.example`: no new env vars (model slots/config are code constants).

## Completion Checklist

- [ ] The pass proposes personality, political-position, and user-political-note patches; compasses are derived (never patched).
- [ ] Personality signals live in `bot_personality_signals` (append-only); the live `decideBehavior` prompt does **not** render them; the evolution prompt does.
- [ ] Bot compass derived from `positions[]`; each user compass derived from active notes; both clamped to `[-10,10]` / `[0,1]`.
- [ ] `user.contest_political_note` moves a note `active → contested → inactive` without deletion; `politics.*` status flags never delete.
- [ ] Radical political content applies only after a stronger-model review (high-risk pre-escalation or radical-patch re-run); else recorded `escalated`.
- [ ] Evolution patches apply best-effort and independently; each records a `BehaviorPatchResult`.
- [ ] User descriptive snapshots and user compasses don't clobber event-patched/runtime-derived social fields.
- [ ] The pass logs a `behavior_events` row with `modelSlot: 'stateEvolution'` and never re-triggers on its own events.
- [ ] Trigger (threshold + cooldown + high-risk floor), dedup worker, and cron sweep behave per config.
- [ ] Coordinates render into the live decision prompt (context-only; no computed political-distance field, no forced tone bias).
- [ ] No `MainService` cutover and no cron started in bootstrap.
- [ ] `pnpm test`, `type:check`, `lint`, `format`, `build` all pass.

## Self-Review (completed during authoring)

- **Spec coverage.** State-Evolution Pass (personality/political/user-political patch proposal + descriptive snapshots + both compass derivations) → Tasks 10/11/12/13/15; triggering/cadence (threshold + cooldown + sweep, dedup worker, risk gating) → Tasks 16/17/18; logs by `modelSlot` → Task 14; reads delta + state, advances high-water mark → Tasks 6/13/15. Political Coordinates: Compass Model + Bot/User compass derivation + `user_political_profiles` + `UserPoliticalPatch` + compass rendering + validator/policy bounds → Tasks 1/2/3/5/9/10/11/15. The Phase-1 personality-signal storage gap is filled in Tasks 1/4 (separate table per decision 3).
- **Type consistency.** `applyEvolutionPatches`, `StateEvolutionContext`/`Result`/`Decision`, `PoliticalCompass`/`PoliticalNote`/`UserPoliticalProfile`/`PersonalitySignal`, `UserPoliticalPatch` in `evolutionPatchSchema`, the new outcome/ref variants, the `stateEvolution` slot, and the three new prompt keys are used identically across tasks.
- **No placeholders.** Every step lists exact files, code or precise rules, run commands, and commits.

## Risks / notes carried forward

- **Snapshot vs. rejected patch.** A derived snapshot/compass may reflect a signal/note the policy later rejects (one holistic call). Accepted for v1; later evidence reconciles.
- **Cursor race.** A live decision logged concurrently with the pass could be skipped when the cursor jumps to the pass's own event id. Single-process + per-chat dedup makes this rare; revisit with the per-chat concurrency key (out of scope for v1).
- **Prompt naming deviation.** The spec folds user compass + notes into `user_profiles_prompt.md`; this codebase keeps social and political user data in separate entities, so they render via a separate `user_political_profiles_prompt.md` block. Functionally equivalent (both render in the same prompt).
- **Phase 5 wiring.** `StateEvolutionScheduler.start()` and routing live Telegram traffic through `BehaviorPipeline` (which already calls the trigger) are deferred to the Phase 5 cutover plan.
```