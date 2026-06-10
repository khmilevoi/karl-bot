# AI Behavior Evolution — Phase 1: Data and Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data layer and AI contracts for the behavior system — Zod-authored schemas (single source of truth), inferred TypeScript types, OpenAI-strict JSON Schema generation, six new SQLite tables with repositories, the `BehaviorDecisionValidator`, and the per-domain `PatchPolicy` — without touching the still-live legacy answer flow.

**Architecture:** Behavior contracts are authored once as Zod v4 schemas under `src/domain/behavior/schemas/`; TypeScript types are inferred via `z.infer` and the OpenAI JSON Schema is generated from the same schemas via a `toOpenAiJsonSchema` wrapper. Persisted state lives in six new tables (additive migration `015`, FK-linked to the existing `chats`/`users`), accessed only through repository interfaces following the project's existing SQLite repository pattern. Validation (`BehaviorDecisionValidator`) and per-patch policy (`PatchPolicy`) are pure application services with no state mutation (application happens in later phases).

**Tech Stack:** TypeScript (CommonJS), Zod `^4.4.3`, OpenAI SDK `^6.39.1`, Inversify `^7` (Symbol-based DI), `sqlite`/`sqlite3`, Vitest `^3`, oxlint/oxfmt.

---

## Source

Spec: [`docs/superpowers/specs/2026-05-28-ai-behavior-evolution-design.md`](../specs/2026-05-28-ai-behavior-evolution-design.md) — sections: Behavior Decision Contract, State Patch Contract, Schema Ownership, Blank-Slate Personality, Political State, User Social Profiles, Social Tools (Truths), Storage, Validation and Runtime Policy, AI-Agent-Friendly Error Logs, Phasing (Phase 1).

Tracker (decisions, sequencing): [`2026-05-28-ai-behavior-evolution-tracker.md`](2026-05-28-ai-behavior-evolution-tracker.md).

## Key decisions locked for this phase

1. **Zod v4 + native `z.toJSONSchema()`.** Already installed (`^4.4.3`). No converter, no upgrade.
2. **Additive migration only.** Phase 1 *adds* six tables. It does **not** drop legacy tables and does **not** remove `users.attitude` — that destructive step is deferred to the Phase 5 cutover plan so the legacy flow keeps working.
3. **Evidence message IDs reference `messages.id`** (the bot's own autoincrement PK), not the nullable Telegram `message_id`.
4. **OpenAI strict transforms:** `z.toJSONSchema` already gives `additionalProperties:false`, all-required, and nullable-as-`anyOf`. The wrapper additionally (a) strips the root `$schema` key and (b) rewrites every `oneOf` to `anyOf` (OpenAI strict supports `anyOf`, not `oneOf`). All optional values are expressed as `T | null` (`.nullable()`), never `.optional()`.
5. **Canonical schema location:** `src/domain/behavior/schemas/`. Types are inferred from schemas there (no duplicate hand-written interfaces), satisfying the spec's "types inferred with `z.infer`". This is a deliberate, documented deviation from the `domain/entities/XxxEntity.ts` convention for the AI-contract + state types; plain row-DTO interfaces for `behavior_events` / `ai_error_events` still live in `domain/entities/`.
6. **OpenAI JSON Schema is precomputed once, statically.** `toOpenAiJsonSchema(...)` is called at module-load time and exported as a constant (`behaviorGateJsonSchema`, `behaviorDecisionJsonSchema`) right next to its Zod schema — never regenerated per request. Because the schemas are static, the generation is a one-time cost. The `toOpenAiJsonSchema` helper therefore lives **in `domain/behavior/schemas/`** (not `application/`), so the schema modules can call it without a domain→application dependency.
7. **No unit tests for the Zod schemas themselves.** Asserting that `z.object(...).safeParse()` accepts/rejects values only re-tests the Zod library. We test our own code: the JSON-schema generator and its precomputed constants, the migration, the repositories, the validator, and the policy. The Zod schemas are exercised indirectly through those.

## File Structure

**Create — canonical Zod schemas + generated OpenAI JSON Schema (`src/domain/behavior/schemas/`):**
- `jsonSchema.ts` — `toOpenAiJsonSchema(schema, name)` generator (lives in domain so schema modules can use it without a domain→application dependency).
- `primitives.ts` — `patchEvidenceSchema`, `confidenceSchema`, `messageIdSchema`, shared enums.
- `gate.ts` — `behaviorGateDecisionSchema` **and** the precomputed `behaviorGateJsonSchema` constant.
- `actions.ts` — per-action schemas + `behaviorActionSchema`.
- `patches.ts` — `userProfilePatchSchema`, `truthPatchSchema`, `liveStatePatchSchema`, `personalityPatchSchema`, `politicalPatchSchema`, `evolutionPatchSchema`.
- `decision.ts` — `behaviorDecisionSchema` **and** the precomputed `behaviorDecisionJsonSchema` constant.
- `state.ts` — `socialSignalSchema`, `patternSignalSchema`, `botPersonalityStateSchema`, `politicalPositionSchema`, `politicalInfluenceSchema`, `botPoliticalStateSchema`, `userSocialProfileSchema`, `botTruthSchema`.
- `index.ts` — re-export all schemas, inferred types, and the precomputed JSON-schema constants.

**Create — application services (`src/application/behavior/`):**
- `BehaviorDecisionValidator.ts` — interface + symbol.
- `DefaultBehaviorDecisionValidator.ts` — impl.
- `PatchPolicy.ts` — interface + symbol + config type.
- `DefaultPatchPolicy.ts` — impl.

**Create — row-DTO entities (`src/domain/entities/`):**
- `BehaviorEventEntity.ts`, `AiErrorEventEntity.ts`.

**Create — repository interfaces (`src/domain/repositories/`):**
- `PersonalityStateRepository.ts`, `PoliticalStateRepository.ts`, `UserSocialProfileRepository.ts`, `TruthRepository.ts`, `BehaviorEventRepository.ts`, `AiErrorEventRepository.ts`.

**Create — SQLite implementations (`src/infrastructure/persistence/sqlite/`):**
- `SQLitePersonalityStateRepository.ts`, `SQLitePoliticalStateRepository.ts`, `SQLiteUserSocialProfileRepository.ts`, `SQLiteTruthRepository.ts`, `SQLiteBehaviorEventRepository.ts`, `SQLiteAiErrorEventRepository.ts`.

**Create — migration (`migrations/`):**
- `015_create_behavior_tables.up.sql`, `015_create_behavior_tables.down.sql`.

**Create — tests (`test/`):**
- `behaviorJsonSchema.test.ts`, `behaviorMigration015.test.ts`, `behaviorStateRepositories.test.ts`, `behaviorEventRepositories.test.ts`, `BehaviorDecisionValidator.test.ts`, `PatchPolicy.test.ts`.
- No `behaviorSchemas.test.ts`: the Zod schema modules are not unit-tested in isolation (that would re-test Zod). They are exercised through the JSON-schema constants, the validator, the policy, and the repository round-trips.

**Modify:**
- `src/container/repositories.ts` — register the six new repositories.

## Conventions (follow exactly)

- No `any`, no `@ts-` directives, no default exports.
- Prefer pattern-matching / discriminated-union switches over ternary chains (project rule).
- Run `pnpm lint:fix` and `pnpm format:fix` before each commit; `pnpm type:check` must pass.
- Tests: `pnpm test <path>` runs a single file (`vitest run`). Repositories are tested against a temp SQLite DB built inline (see `test/sqliteRepositories.test.ts` for the established pattern).
- SQLite columns are `snake_case`; JSON-serialized columns get a `_json` suffix and the corresponding entity field gets a `Json` suffix only for the opaque row DTOs (`behavior_events`, `ai_error_events`); the rich state repos parse JSON columns into typed fields.

---

## Task 1: Schema primitives + OpenAI JSON Schema generator

**Files:**
- Create: `src/domain/behavior/schemas/primitives.ts`
- Create: `src/domain/behavior/schemas/jsonSchema.ts`
- Test: `test/behaviorJsonSchema.test.ts`

- [ ] **Step 1: Write `primitives.ts`**

```typescript
import { z } from 'zod';

export const confidenceSchema = z.number().min(0).max(1);

// Evidence message IDs reference the bot's own message store (messages.id),
// not the nullable Telegram message_id.
export const messageIdSchema = z.number().int();

export const patchEvidenceSchema = z.object({
  messageIds: z.array(messageIdSchema),
  summary: z.string(),
  confidence: confidenceSchema,
});

export const stateImpactRiskSchema = z.enum(['none', 'low', 'medium', 'high']);

export const intensitySchema = z.enum(['weak', 'moderate', 'strong', 'radical']);

export const signalStatusSchema = z.enum(['active', 'contested', 'inactive']);

export type PatchEvidence = z.infer<typeof patchEvidenceSchema>;
export type StateImpactRisk = z.infer<typeof stateImpactRiskSchema>;
```

- [ ] **Step 2: Write the failing test for the JSON Schema generator**

```typescript
// test/behaviorJsonSchema.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toOpenAiJsonSchema } from '../src/domain/behavior/schemas/jsonSchema';

// Assert the entire normalized schema with deep equality rather than searching
// for substrings: a substring check gives false results when a property is
// literally named `minimum` or when `anyOf` appears in an unrelated branch.
describe('toOpenAiJsonSchema', () => {
  it('wraps a schema in a strict named response format (full result)', () => {
    const schema = z.object({ a: z.string(), b: z.number().nullable() });
    expect(toOpenAiJsonSchema(schema, 'sample')).toEqual({
      name: 'sample',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
        required: ['a', 'b'],
        additionalProperties: false,
      },
    });
  });

  it('rewrites discriminated-union oneOf to anyOf (full schema)', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), x: z.number() }),
      z.object({ type: z.literal('b'), y: z.string().nullable() }),
    ]);
    expect(toOpenAiJsonSchema(schema, 'u').schema).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'a' },
            x: { type: 'number' },
          },
          required: ['type', 'x'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'b' },
            y: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: ['type', 'y'],
          additionalProperties: false,
        },
      ],
    });
  });

  it('strips the root $schema while keeping nested objects intact (full schema)', () => {
    const schema = z.object({ nested: z.object({ a: z.string() }) });
    expect(toOpenAiJsonSchema(schema, 'n').schema).toEqual({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
          additionalProperties: false,
        },
      },
      required: ['nested'],
      additionalProperties: false,
    });
  });

  it('strips validation keywords OpenAI strict rejects (full schema)', () => {
    const schema = z.object({
      c: z.number().min(0).max(1),
      ids: z.array(z.number().int()).min(1),
    });
    expect(toOpenAiJsonSchema(schema, 's').schema).toEqual({
      type: 'object',
      properties: {
        c: { type: 'number' },
        ids: { type: 'array', items: { type: 'integer' } },
      },
      required: ['c', 'ids'],
      additionalProperties: false,
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test test/behaviorJsonSchema.test.ts`
Expected: FAIL — `Cannot find module '../src/domain/behavior/schemas/jsonSchema'`.

- [ ] **Step 4: Write `jsonSchema.ts`**

```typescript
import type { ZodType } from 'zod';
import { z } from 'zod';

export interface OpenAiResponseFormatSchema {
  name: string;
  strict: true;
  schema: Record<string, unknown>;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// OpenAI strict structured output supports only a limited keyword set. Zod v4
// emits validation keywords strict mode rejects — numeric ranges (even
// `z.number().int()` adds huge minimum/maximum bounds), string/array length,
// pattern/format. Drop them here; these bounds are re-enforced in
// BehaviorDecisionValidator, which parses against the full Zod schema.
const STRIP_KEYS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
]);

// In addition to stripping the keys above, unions must use `anyOf` rather than
// the `oneOf` Zod emits for discriminated unions.
function normalize(node: JsonValue): JsonValue {
  if (Array.isArray(node)) {
    return node.map(normalize);
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }

  const result: { [key: string]: JsonValue } = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIP_KEYS.has(key)) {
      continue;
    }
    const outKey = key === 'oneOf' ? 'anyOf' : key;
    result[outKey] = normalize(value);
  }
  return result;
}

export function toOpenAiJsonSchema(
  schema: ZodType,
  name: string
): OpenAiResponseFormatSchema {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as JsonValue;
  const normalized = normalize(raw) as Record<string, unknown>;
  return { name, strict: true, schema: normalized };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test test/behaviorJsonSchema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Lint, format, type-check, commit**

```bash
pnpm lint:fix && pnpm format:fix && pnpm type:check
git add src/domain/behavior/schemas/primitives.ts src/domain/behavior/schemas/jsonSchema.ts test/behaviorJsonSchema.test.ts
git commit -m "feat(behavior): add schema primitives and OpenAI JSON Schema generator"
```

---

## Task 2: Gate decision schema (+ precomputed JSON schema)

**Files:**
- Create: `src/domain/behavior/schemas/gate.ts`

No Zod unit test (would re-test Zod). The exported `behaviorGateJsonSchema` constant is asserted in Task 5's `behaviorJsonSchema.test.ts`.

- [ ] **Step 1: Write `gate.ts`** (schema + precomputed OpenAI JSON schema constant)

```typescript
import { z } from 'zod';

import { toOpenAiJsonSchema } from './jsonSchema';
import {
  confidenceSchema,
  messageIdSchema,
  stateImpactRiskSchema,
} from './primitives';

export const gateReasonSchema = z.enum([
  'direct_trigger',
  'conflict',
  'strong_emotion',
  'political_claim',
  'attitude_to_carl',
  'user_relationship_signal',
  'group_truth_candidate',
  'personality_signal',
  'not_relevant',
]);

export const behaviorGateDecisionSchema = z.object({
  shouldDecide: z.boolean(),
  confidence: confidenceSchema,
  reason: gateReasonSchema,
  triggerMessageIds: z.array(messageIdSchema),
  contextMessageIds: z.array(messageIdSchema),
  stateImpactRisk: stateImpactRiskSchema,
});

// Precomputed once at module load — static data, never regenerated per request.
export const behaviorGateJsonSchema = toOpenAiJsonSchema(
  behaviorGateDecisionSchema,
  'BehaviorGateDecision'
);

export type GateReason = z.infer<typeof gateReasonSchema>;
export type BehaviorGateDecision = z.infer<typeof behaviorGateDecisionSchema>;
```

- [ ] **Step 2: Type-check, lint, format, commit**

```bash
pnpm type:check && pnpm lint:fix && pnpm format:fix
git add src/domain/behavior/schemas/gate.ts
git commit -m "feat(behavior): add gate decision schema with precomputed JSON schema"
```

---

## Task 3: Behavior action schemas

**Files:**
- Create: `src/domain/behavior/schemas/actions.ts`

- [ ] **Step 1: Write `actions.ts`**

```typescript
import { z } from 'zod';

import { messageIdSchema } from './primitives';

export const replyActionSchema = z.object({
  type: z.literal('reply'),
  intent: z.enum(['direct_answer', 'banter', 'argument', 'support', 'correction']),
  text: z.string(),
  replyTo: z.enum(['trigger', 'latest', 'none']),
});

export const reactActionSchema = z.object({
  type: z.literal('react'),
  intent: z.enum(['approval', 'disapproval', 'mockery', 'acknowledgement']),
  emoji: z.string(),
  targetMessageId: messageIdSchema,
});

export const askQuestionActionSchema = z.object({
  type: z.literal('ask_question'),
  intent: z.enum(['clarify', 'provoke', 'invite', 'challenge']),
  text: z.string(),
  targetUsername: z.string().nullable(),
});

export const summarizeThreadActionSchema = z.object({
  type: z.literal('summarize_thread'),
  intent: z.enum(['compress_context', 'state_review']),
  reason: z.string(),
});

export const behaviorActionSchema = z.discriminatedUnion('type', [
  replyActionSchema,
  reactActionSchema,
  askQuestionActionSchema,
  summarizeThreadActionSchema,
]);

export type BehaviorAction = z.infer<typeof behaviorActionSchema>;
```

- [ ] **Step 2: Type-check, lint, format, commit**

```bash
pnpm type:check && pnpm lint:fix && pnpm format:fix
git add src/domain/behavior/schemas/actions.ts
git commit -m "feat(behavior): add behavior action schemas"
```

---

## Task 4: State patch schemas (live + evolution)

**Files:**
- Create: `src/domain/behavior/schemas/patches.ts`

- [ ] **Step 1: Write `patches.ts`**

```typescript
import { z } from 'zod';

import { intensitySchema, patchEvidenceSchema } from './primitives';

// --- User profile patches (live lane) ---

export const userAdjustAffinityPatchSchema = z.object({
  type: z.literal('user.adjust_affinity'),
  userId: z.number().int(),
  delta: z.union([z.literal(-1), z.literal(1)]),
  evidence: patchEvidenceSchema,
});

export const userAddLabelPatchSchema = z.object({
  type: z.literal('user.add_label'),
  userId: z.number().int(),
  label: z.string(),
  evidence: patchEvidenceSchema,
});

export const userAddPatternPatchSchema = z.object({
  type: z.literal('user.add_pattern'),
  userId: z.number().int(),
  polarity: z.enum(['positive', 'negative', 'neutral']),
  text: z.string(),
  evidence: patchEvidenceSchema,
});

export const userAddGrudgePatchSchema = z.object({
  type: z.literal('user.add_grudge'),
  userId: z.number().int(),
  text: z.string(),
  evidence: patchEvidenceSchema,
});

export const userContestProfileSignalPatchSchema = z.object({
  type: z.literal('user.contest_profile_signal'),
  userId: z.number().int(),
  target: z.object({
    kind: z.enum(['label', 'pattern', 'grudge']),
    text: z.string(),
  }),
  evidence: patchEvidenceSchema,
});

export const userProfilePatchSchema = z.discriminatedUnion('type', [
  userAdjustAffinityPatchSchema,
  userAddLabelPatchSchema,
  userAddPatternPatchSchema,
  userAddGrudgePatchSchema,
  userContestProfileSignalPatchSchema,
]);

// --- Truth patches (live lane) ---

export const truthAddPatchSchema = z.object({
  type: z.literal('truth.add'),
  text: z.string(),
  relatedTruthIds: z.array(z.number().int()),
  contradictsTruthIds: z.array(z.number().int()),
  evidence: patchEvidenceSchema,
});

export const truthReinforcePatchSchema = z.object({
  type: z.literal('truth.reinforce'),
  truthId: z.number().int(),
  evidence: patchEvidenceSchema,
});

export const truthContestPatchSchema = z.object({
  type: z.literal('truth.contest'),
  truthId: z.number().int(),
  counterText: z.string(),
  evidence: patchEvidenceSchema,
});

export const truthRevisePatchSchema = z.object({
  type: z.literal('truth.revise'),
  truthId: z.number().int(),
  revisedText: z.string(),
  evidence: patchEvidenceSchema,
});

export const truthPatchSchema = z.discriminatedUnion('type', [
  truthAddPatchSchema,
  truthReinforcePatchSchema,
  truthContestPatchSchema,
  truthRevisePatchSchema,
]);

export const liveStatePatchSchema = z.discriminatedUnion('type', [
  userAdjustAffinityPatchSchema,
  userAddLabelPatchSchema,
  userAddPatternPatchSchema,
  userAddGrudgePatchSchema,
  userContestProfileSignalPatchSchema,
  truthAddPatchSchema,
  truthReinforcePatchSchema,
  truthContestPatchSchema,
  truthRevisePatchSchema,
]);

// --- Evolution patches (background pass; not in the live schema) ---

export const personalityPatchSchema = z.object({
  type: z.literal('personality.add_signal'),
  area: z.enum(['identity', 'values', 'speech_style', 'social_habits', 'themes']),
  polarity: z.enum(['reinforce', 'contest', 'soften']),
  text: z.string(),
  evidence: patchEvidenceSchema,
});

export const politicsAddPositionPatchSchema = z.object({
  type: z.literal('politics.add_position'),
  topic: z.string(),
  stance: z.string(),
  requestedIntensity: intensitySchema,
  evidence: patchEvidenceSchema,
});

export const politicsAdjustPositionPatchSchema = z.object({
  type: z.literal('politics.adjust_position'),
  positionId: z.number().int(),
  direction: z.enum(['radicalize', 'soften', 'contest', 'reverse']),
  evidence: patchEvidenceSchema,
});

export const politicsAddUncertaintyPatchSchema = z.object({
  type: z.literal('politics.add_uncertainty'),
  topic: z.string(),
  summary: z.string(),
  evidence: patchEvidenceSchema,
});

export const politicalPatchSchema = z.discriminatedUnion('type', [
  politicsAddPositionPatchSchema,
  politicsAdjustPositionPatchSchema,
  politicsAddUncertaintyPatchSchema,
]);

export const evolutionPatchSchema = z.discriminatedUnion('type', [
  personalityPatchSchema,
  politicsAddPositionPatchSchema,
  politicsAdjustPositionPatchSchema,
  politicsAddUncertaintyPatchSchema,
]);

export type UserProfilePatch = z.infer<typeof userProfilePatchSchema>;
export type TruthPatch = z.infer<typeof truthPatchSchema>;
export type LiveStatePatch = z.infer<typeof liveStatePatchSchema>;
export type PersonalityPatch = z.infer<typeof personalityPatchSchema>;
export type PoliticalPatch = z.infer<typeof politicalPatchSchema>;
export type EvolutionPatch = z.infer<typeof evolutionPatchSchema>;
```

- [ ] **Step 2: Type-check, lint, format, commit**

```bash
pnpm type:check && pnpm lint:fix && pnpm format:fix
git add src/domain/behavior/schemas/patches.ts
git commit -m "feat(behavior): add live and evolution state patch schemas"
```

---

## Task 5: Behavior decision schema (+ precomputed JSON schema) and contract-schema test

**Files:**
- Create: `src/domain/behavior/schemas/decision.ts`
- Create: `src/domain/behavior/schemas/index.ts`
- Test: `test/behaviorJsonSchema.test.ts` (extend — assert the precomputed constants)

- [ ] **Step 1: Write `decision.ts`** (schema + precomputed OpenAI JSON schema constant)

```typescript
import { z } from 'zod';

import { behaviorActionSchema } from './actions';
import { toOpenAiJsonSchema } from './jsonSchema';
import { liveStatePatchSchema } from './patches';
import { confidenceSchema } from './primitives';

export const behaviorDecisionSchema = z.object({
  confidence: confidenceSchema,
  actions: z.array(behaviorActionSchema),
  statePatches: z.array(liveStatePatchSchema),
  safetyNotes: z.array(z.string()),
});

// Precomputed once at module load — static data, never regenerated per request.
// Consumed by the decideBehavior OpenAI call in Plan 02.
export const behaviorDecisionJsonSchema = toOpenAiJsonSchema(
  behaviorDecisionSchema,
  'BehaviorDecision'
);

export type BehaviorDecision = z.infer<typeof behaviorDecisionSchema>;
```

- [ ] **Step 2: Extend `test/behaviorJsonSchema.test.ts` to assert the precomputed contract schemas**

Append the helper and `describe` block below. The `import` lines go at the top of the file (next to the Task 1 imports); `z` and `toOpenAiJsonSchema` are already imported there. The assertions target the exported **constants** — the exact static artifacts sent to OpenAI — not a fresh `toOpenAiJsonSchema(...)` call.

```typescript
import { behaviorDecisionJsonSchema } from '../src/domain/behavior/schemas/decision';
import { behaviorGateJsonSchema } from '../src/domain/behavior/schemas/gate';

// Whole-schema structural invariants for OpenAI strict, asserted across EVERY
// node of the tree (not substring matching): no oneOf / $schema / numeric or
// length bounds, and every object closed (additionalProperties:false) with
// `required` exactly equal to its property keys. Used for the large
// BehaviorDecision contract, where a full literal would be unwieldy and
// fragile; the small gate contract is asserted by full equality below.
function assertStrict(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(assertStrict);
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const obj = node as Record<string, unknown>;
  expect('oneOf' in obj).toBe(false);
  expect('$schema' in obj).toBe(false);
  expect('minimum' in obj).toBe(false);
  expect('maximum' in obj).toBe(false);
  expect('minItems' in obj).toBe(false);
  if (obj.type === 'object' && 'properties' in obj) {
    expect(obj.additionalProperties).toBe(false);
    const propKeys = Object.keys(obj.properties as Record<string, unknown>);
    expect(new Set(obj.required as string[])).toEqual(new Set(propKeys));
  }
  Object.values(obj).forEach(assertStrict);
}

describe('precomputed behavior contract JSON schemas', () => {
  it('precomputes the exact gate schema (full equality)', () => {
    expect(behaviorGateJsonSchema.name).toBe('BehaviorGateDecision');
    expect(behaviorGateJsonSchema.strict).toBe(true);
    expect(behaviorGateJsonSchema.schema).toEqual({
      type: 'object',
      properties: {
        shouldDecide: { type: 'boolean' },
        confidence: { type: 'number' },
        reason: {
          type: 'string',
          enum: [
            'direct_trigger',
            'conflict',
            'strong_emotion',
            'political_claim',
            'attitude_to_carl',
            'user_relationship_signal',
            'group_truth_candidate',
            'personality_signal',
            'not_relevant',
          ],
        },
        triggerMessageIds: { type: 'array', items: { type: 'integer' } },
        contextMessageIds: { type: 'array', items: { type: 'integer' } },
        stateImpactRisk: {
          type: 'string',
          enum: ['none', 'low', 'medium', 'high'],
        },
      },
      required: [
        'shouldDecide',
        'confidence',
        'reason',
        'triggerMessageIds',
        'contextMessageIds',
        'stateImpactRisk',
      ],
      additionalProperties: false,
    });
  });

  it('precomputes a strict-compatible BehaviorDecision schema (whole-tree invariants)', () => {
    expect(behaviorDecisionJsonSchema.name).toBe('BehaviorDecision');
    expect(behaviorDecisionJsonSchema.strict).toBe(true);
    assertStrict(behaviorDecisionJsonSchema.schema);
  });
});
```

- [ ] **Step 3: Write `src/domain/behavior/schemas/index.ts`**

```typescript
export * from './jsonSchema';
export * from './primitives';
export * from './gate';
export * from './actions';
export * from './patches';
export * from './decision';
```

> `./state` is added in Task 6 — do **not** include it yet (the module does not exist; the import would fail to compile).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test test/behaviorJsonSchema.test.ts`
Expected: PASS. If `assertStrict` fails on `required` for a nested object, the cause is an `.optional()` somewhere — replace it with `.nullable()`. If the gate equality fails, diff actual vs expected (a Zod-version change in emission is the usual cause; update the expected literal to match the new emission, keeping the strict invariants).

- [ ] **Step 5: Lint, format, type-check, commit**

```bash
pnpm lint:fix && pnpm format:fix && pnpm type:check
git add src/domain/behavior/schemas/decision.ts src/domain/behavior/schemas/index.ts test/behaviorJsonSchema.test.ts
git commit -m "feat(behavior): add decision schema and precomputed contract JSON schemas"
```

---

## Task 6: Persisted state schemas

**Files:**
- Create: `src/domain/behavior/schemas/state.ts`
- Modify: `src/domain/behavior/schemas/index.ts` (add `export * from './state';`)

- [ ] **Step 1: Write `state.ts`**

```typescript
import { z } from 'zod';

import { confidenceSchema, messageIdSchema, signalStatusSchema } from './primitives';

export const socialSignalSchema = z.object({
  text: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  status: signalStatusSchema,
});

export const patternSignalSchema = z.object({
  polarity: z.enum(['positive', 'negative', 'neutral']),
  text: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  status: signalStatusSchema,
});

export const speechStyleSchema = z.object({
  tone: z.string(),
  humor: z.string(),
  verbosity: z.enum(['short', 'medium', 'essay']),
  formality: z.enum(['low', 'medium', 'high']),
});

export const botPersonalityStateSchema = z.object({
  chatId: z.number().int(),
  identityNotes: z.array(z.string()),
  values: z.array(z.string()),
  speechStyle: speechStyleSchema,
  socialHabits: z.array(z.string()),
  recurringThemes: z.array(z.string()),
  lastUpdatedAt: z.string(),
});

export const politicalPositionSchema = z.object({
  id: z.number().int(),
  topic: z.string(),
  stance: z.string(),
  intensity: z.enum(['weak', 'moderate', 'strong', 'radical']),
  confidence: confidenceSchema,
  status: z.enum(['active', 'contested', 'softened', 'reversed']),
  evidenceMessageIds: z.array(messageIdSchema),
  opposingEvidenceMessageIds: z.array(messageIdSchema),
  origin: z.enum(['chat_discussion', 'bot_reflection']),
  updatedAt: z.string(),
});

export const politicalInfluenceSchema = z.object({
  source: z.enum(['chat_discussion', 'bot_reflection']),
  summary: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  confidence: confidenceSchema,
  createdAt: z.string(),
});

export const botPoliticalStateSchema = z.object({
  chatId: z.number().int(),
  ideologySummary: z.string(),
  positions: z.array(politicalPositionSchema),
  uncertaintyAreas: z.array(z.string()),
  influenceHistory: z.array(politicalInfluenceSchema),
  lastUpdatedAt: z.string(),
});

export const userSocialProfileSchema = z.object({
  userId: z.number().int(),
  chatId: z.number().int(),
  username: z.string().nullable(),
  affinityScore: z.number().int().gte(-3).lte(3),
  labels: z.array(socialSignalSchema),
  patterns: z.array(patternSignalSchema),
  grudges: z.array(socialSignalSchema),
  trustLevel: z.enum(['none', 'low', 'medium', 'high']),
  preferredDistance: z.enum([
    'warm',
    'neutral',
    'cold',
    'mocking',
    'avoidant',
    'hostile',
  ]),
  communicationStyle: z.string(),
  conflictStyle: z.string(),
  preferredTone: z.string(),
  interests: z.array(z.string()),
  updatedAt: z.string(),
});

export const botTruthSchema = z.object({
  id: z.number().int(),
  chatId: z.number().int(),
  text: z.string(),
  sourceMessageIds: z.array(messageIdSchema),
  confidence: confidenceSchema,
  relatedTruthIds: z.array(z.number().int()),
  contradictsTruthIds: z.array(z.number().int()),
  status: z.enum(['fresh', 'stable', 'contested', 'superseded']),
  createdAt: z.string(),
});

export type SocialSignal = z.infer<typeof socialSignalSchema>;
export type PatternSignal = z.infer<typeof patternSignalSchema>;
export type SpeechStyle = z.infer<typeof speechStyleSchema>;
export type BotPersonalityState = z.infer<typeof botPersonalityStateSchema>;
export type PoliticalPosition = z.infer<typeof politicalPositionSchema>;
export type PoliticalInfluence = z.infer<typeof politicalInfluenceSchema>;
export type BotPoliticalState = z.infer<typeof botPoliticalStateSchema>;
export type UserSocialProfile = z.infer<typeof userSocialProfileSchema>;
export type BotTruth = z.infer<typeof botTruthSchema>;
```

- [ ] **Step 2: Add `export * from './state';` to `src/domain/behavior/schemas/index.ts`**

- [ ] **Step 3: Type-check, lint, format, commit**

```bash
pnpm type:check && pnpm lint:fix && pnpm format:fix
git add src/domain/behavior/schemas/state.ts src/domain/behavior/schemas/index.ts
git commit -m "feat(behavior): add persisted state schemas"
```

---

## Task 7: Row-DTO entities for behavior_events and ai_error_events

**Files:**
- Create: `src/domain/entities/BehaviorEventEntity.ts`
- Create: `src/domain/entities/AiErrorEventEntity.ts`

These are persistence row DTOs (opaque JSON columns kept as strings), matching the spec's `BehaviorEvent`/`AiErrorEvent` interfaces. They are not AI I/O contracts, so plain interfaces (project convention) are appropriate. `id` is omitted on insert.

- [ ] **Step 1: Write `BehaviorEventEntity.ts`**

```typescript
export interface BehaviorEventEntity {
  id: number;
  chatId: number;
  schemaVersion: string;
  gateReason: string | null;
  gateConfidence: number | null;
  gateStateImpactRisk: string | null;
  triggerMessageIdsJson: string;
  contextMessageIdsJson: string;
  modelSlot: string;
  selectedModel: string;
  escalated: boolean;
  escalationReason: string | null;
  actionsJson: string;
  actionResultsJson: string;
  statePatchesJson: string;
  patchResultsJson: string;
  confidence: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export type NewBehaviorEvent = Omit<BehaviorEventEntity, 'id'>;
```

- [ ] **Step 2: Write `AiErrorEventEntity.ts`**

```typescript
export interface AiErrorEventEntity {
  id: number;
  chatId: number | null;
  source: string;
  severity: 'warning' | 'error' | 'critical';
  errorCode: string;
  message: string;
  component: string;
  operation: string;
  inputRefJson: string | null;
  outputRefJson: string | null;
  stackHash: string | null;
  fixHint: string;
  status: 'open' | 'resolved' | 'ignored';
  createdAt: string;
}

export type NewAiErrorEvent = Omit<AiErrorEventEntity, 'id'>;
```

- [ ] **Step 3: Type-check, lint, format, commit** (no test — type-only files exercised by repo tests in Tasks 10–11)

```bash
pnpm lint:fix && pnpm format:fix && pnpm type:check
git add src/domain/entities/BehaviorEventEntity.ts src/domain/entities/AiErrorEventEntity.ts
git commit -m "feat(behavior): add behavior/error event row DTOs"
```

---

## Task 8: Additive migration — six behavior tables

**Files:**
- Create: `migrations/015_create_behavior_tables.up.sql`
- Create: `migrations/015_create_behavior_tables.down.sql`
- Test: `test/behaviorMigration015.test.ts`

This migration is **purely additive** (no drops, no `users.attitude` removal). FKs reference existing `chats(chat_id)` and `users(id)`.

- [ ] **Step 1: Write `015_create_behavior_tables.up.sql`**

```sql
CREATE TABLE IF NOT EXISTS bot_personality_states (
  chat_id INTEGER PRIMARY KEY,
  identity_notes_json TEXT NOT NULL DEFAULT '[]',
  values_json TEXT NOT NULL DEFAULT '[]',
  speech_style_json TEXT NOT NULL DEFAULT '{}',
  social_habits_json TEXT NOT NULL DEFAULT '[]',
  recurring_themes_json TEXT NOT NULL DEFAULT '[]',
  last_updated_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS bot_political_states (
  chat_id INTEGER PRIMARY KEY,
  ideology_summary TEXT NOT NULL DEFAULT '',
  positions_json TEXT NOT NULL DEFAULT '[]',
  uncertainty_areas_json TEXT NOT NULL DEFAULT '[]',
  influence_history_json TEXT NOT NULL DEFAULT '[]',
  last_updated_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS bot_truths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  source_message_ids_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  related_truth_ids_json TEXT NOT NULL DEFAULT '[]',
  contradicts_truth_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'fresh',
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS user_social_profiles (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT,
  affinity_score INTEGER NOT NULL DEFAULT 0,
  labels_json TEXT NOT NULL DEFAULT '[]',
  patterns_json TEXT NOT NULL DEFAULT '[]',
  grudges_json TEXT NOT NULL DEFAULT '[]',
  trust_level TEXT NOT NULL DEFAULT 'none',
  preferred_distance TEXT NOT NULL DEFAULT 'neutral',
  communication_style TEXT NOT NULL DEFAULT '',
  conflict_style TEXT NOT NULL DEFAULT '',
  preferred_tone TEXT NOT NULL DEFAULT '',
  interests_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS behavior_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  schema_version TEXT NOT NULL,
  gate_reason TEXT,
  gate_confidence REAL,
  gate_state_impact_risk TEXT,
  trigger_message_ids_json TEXT NOT NULL DEFAULT '[]',
  context_message_ids_json TEXT NOT NULL DEFAULT '[]',
  model_slot TEXT NOT NULL,
  selected_model TEXT NOT NULL,
  escalated INTEGER NOT NULL DEFAULT 0,
  escalation_reason TEXT,
  actions_json TEXT NOT NULL DEFAULT '[]',
  action_results_json TEXT NOT NULL DEFAULT '[]',
  state_patches_json TEXT NOT NULL DEFAULT '[]',
  patch_results_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE TABLE IF NOT EXISTS ai_error_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER,
  source TEXT NOT NULL,
  severity TEXT NOT NULL,
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  component TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_ref_json TEXT,
  output_ref_json TEXT,
  stack_hash TEXT,
  fix_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_behavior_events_chat ON behavior_events(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_bot_truths_chat ON bot_truths(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_error_events_status ON ai_error_events(status, id);
```

- [ ] **Step 2: Write `015_create_behavior_tables.down.sql`**

```sql
DROP INDEX IF EXISTS idx_ai_error_events_status;
DROP INDEX IF EXISTS idx_bot_truths_chat;
DROP INDEX IF EXISTS idx_behavior_events_chat;
DROP TABLE IF EXISTS ai_error_events;
DROP TABLE IF EXISTS behavior_events;
DROP TABLE IF EXISTS user_social_profiles;
DROP TABLE IF EXISTS bot_truths;
DROP TABLE IF EXISTS bot_political_states;
DROP TABLE IF EXISTS bot_personality_states;
```

- [ ] **Step 3: Write the failing migration test**

```typescript
// test/behaviorMigration015.test.ts
import { readFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof open>>;

let db: Db;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mig015-'));
  db = await open({ filename: path.join(dir, 't.db'), driver: sqlite3.Database });
  // Prerequisite operational tables for FK targets.
  await db.exec(`
    CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
  `);
});

describe('migration 015 (behavior tables)', () => {
  it('creates the six new tables', async () => {
    const up = readFileSync(
      path.join('migrations', '015_create_behavior_tables.up.sql'),
      'utf8'
    );
    await db.exec(up);

    const rows = await db.all<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const names = rows.map((r) => r.name);
    for (const t of [
      'bot_personality_states',
      'bot_political_states',
      'bot_truths',
      'user_social_profiles',
      'behavior_events',
      'ai_error_events',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('down migration drops the six tables and leaves operational tables intact', async () => {
    const up = readFileSync(
      path.join('migrations', '015_create_behavior_tables.up.sql'),
      'utf8'
    );
    const down = readFileSync(
      path.join('migrations', '015_create_behavior_tables.down.sql'),
      'utf8'
    );
    await db.exec(up);
    await db.exec(down);

    const rows = await db.all<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain('chats');
    expect(names).toContain('users');
    expect(names).not.toContain('behavior_events');
    expect(names).not.toContain('bot_truths');
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test test/behaviorMigration015.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
pnpm lint:fix && pnpm format:fix
git add migrations/015_create_behavior_tables.up.sql migrations/015_create_behavior_tables.down.sql test/behaviorMigration015.test.ts
git commit -m "feat(behavior): add additive migration for six behavior tables"
```

---

## Task 9: State repositories (personality, political, profile, truth)

**Files:**
- Create: `src/domain/repositories/PersonalityStateRepository.ts`, `PoliticalStateRepository.ts`, `UserSocialProfileRepository.ts`, `TruthRepository.ts`
- Create: `src/infrastructure/persistence/sqlite/SQLitePersonalityStateRepository.ts`, `SQLitePoliticalStateRepository.ts`, `SQLiteUserSocialProfileRepository.ts`, `SQLiteTruthRepository.ts`
- Test: `test/behaviorStateRepositories.test.ts`

Method sets are scoped to what Phase 1 can test and later phases consume; more query methods are added in later plans as needed.

- [ ] **Step 1: Write the four repository interfaces**

```typescript
// src/domain/repositories/PersonalityStateRepository.ts
import type { BotPersonalityState } from '@/domain/behavior/schemas/state';

export interface PersonalityStateRepository {
  findByChatId(chatId: number): Promise<BotPersonalityState | undefined>;
  upsert(state: BotPersonalityState): Promise<void>;
}

export const PERSONALITY_STATE_REPOSITORY_ID = Symbol('PersonalityStateRepository');
```

```typescript
// src/domain/repositories/PoliticalStateRepository.ts
import type { BotPoliticalState } from '@/domain/behavior/schemas/state';

export interface PoliticalStateRepository {
  findByChatId(chatId: number): Promise<BotPoliticalState | undefined>;
  upsert(state: BotPoliticalState): Promise<void>;
}

export const POLITICAL_STATE_REPOSITORY_ID = Symbol('PoliticalStateRepository');
```

```typescript
// src/domain/repositories/UserSocialProfileRepository.ts
import type { UserSocialProfile } from '@/domain/behavior/schemas/state';

export interface UserSocialProfileRepository {
  findByChatAndUser(
    chatId: number,
    userId: number
  ): Promise<UserSocialProfile | undefined>;
  findByChat(chatId: number): Promise<UserSocialProfile[]>;
  upsert(profile: UserSocialProfile): Promise<void>;
}

export const USER_SOCIAL_PROFILE_REPOSITORY_ID = Symbol(
  'UserSocialProfileRepository'
);
```

```typescript
// src/domain/repositories/TruthRepository.ts
import type { BotTruth } from '@/domain/behavior/schemas/state';

export type NewTruth = Omit<BotTruth, 'id'>;

export interface TruthRepository {
  add(truth: NewTruth): Promise<number>;
  findById(id: number): Promise<BotTruth | undefined>;
  findByChatId(chatId: number): Promise<BotTruth[]>;
  update(truth: BotTruth): Promise<void>;
}

export const TRUTH_REPOSITORY_ID = Symbol('TruthRepository');
```

- [ ] **Step 2: Write `SQLitePersonalityStateRepository.ts`**

```typescript
import { inject, injectable } from 'inversify';

import type { BotPersonalityState } from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { PersonalityStateRepository } from '@/domain/repositories/PersonalityStateRepository';

interface PersonalityRow {
  chat_id: number;
  identity_notes_json: string;
  values_json: string;
  speech_style_json: string;
  social_habits_json: string;
  recurring_themes_json: string;
  last_updated_at: string;
}

@injectable()
export class SQLitePersonalityStateRepository
  implements PersonalityStateRepository
{
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async findByChatId(chatId: number): Promise<BotPersonalityState | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<PersonalityRow>(
      'SELECT chat_id, identity_notes_json, values_json, speech_style_json, social_habits_json, recurring_themes_json, last_updated_at FROM bot_personality_states WHERE chat_id = ?',
      chatId
    );
    if (!row) {
      return undefined;
    }
    return {
      chatId: row.chat_id,
      identityNotes: JSON.parse(row.identity_notes_json) as string[],
      values: JSON.parse(row.values_json) as string[],
      speechStyle: JSON.parse(
        row.speech_style_json
      ) as BotPersonalityState['speechStyle'],
      socialHabits: JSON.parse(row.social_habits_json) as string[],
      recurringThemes: JSON.parse(row.recurring_themes_json) as string[],
      lastUpdatedAt: row.last_updated_at,
    };
  }

  async upsert(state: BotPersonalityState): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT INTO bot_personality_states
        (chat_id, identity_notes_json, values_json, speech_style_json, social_habits_json, recurring_themes_json, last_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         identity_notes_json=excluded.identity_notes_json,
         values_json=excluded.values_json,
         speech_style_json=excluded.speech_style_json,
         social_habits_json=excluded.social_habits_json,
         recurring_themes_json=excluded.recurring_themes_json,
         last_updated_at=excluded.last_updated_at`,
      state.chatId,
      JSON.stringify(state.identityNotes),
      JSON.stringify(state.values),
      JSON.stringify(state.speechStyle),
      JSON.stringify(state.socialHabits),
      JSON.stringify(state.recurringThemes),
      state.lastUpdatedAt
    );
  }
}
```

- [ ] **Step 3: Write `SQLitePoliticalStateRepository.ts`**

```typescript
import { inject, injectable } from 'inversify';

import type {
  BotPoliticalState,
  PoliticalInfluence,
  PoliticalPosition,
} from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { PoliticalStateRepository } from '@/domain/repositories/PoliticalStateRepository';

interface PoliticalRow {
  chat_id: number;
  ideology_summary: string;
  positions_json: string;
  uncertainty_areas_json: string;
  influence_history_json: string;
  last_updated_at: string;
}

@injectable()
export class SQLitePoliticalStateRepository implements PoliticalStateRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async findByChatId(chatId: number): Promise<BotPoliticalState | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<PoliticalRow>(
      'SELECT chat_id, ideology_summary, positions_json, uncertainty_areas_json, influence_history_json, last_updated_at FROM bot_political_states WHERE chat_id = ?',
      chatId
    );
    if (!row) {
      return undefined;
    }
    return {
      chatId: row.chat_id,
      ideologySummary: row.ideology_summary,
      positions: JSON.parse(row.positions_json) as PoliticalPosition[],
      uncertaintyAreas: JSON.parse(row.uncertainty_areas_json) as string[],
      influenceHistory: JSON.parse(
        row.influence_history_json
      ) as PoliticalInfluence[],
      lastUpdatedAt: row.last_updated_at,
    };
  }

  async upsert(state: BotPoliticalState): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT INTO bot_political_states
        (chat_id, ideology_summary, positions_json, uncertainty_areas_json, influence_history_json, last_updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         ideology_summary=excluded.ideology_summary,
         positions_json=excluded.positions_json,
         uncertainty_areas_json=excluded.uncertainty_areas_json,
         influence_history_json=excluded.influence_history_json,
         last_updated_at=excluded.last_updated_at`,
      state.chatId,
      state.ideologySummary,
      JSON.stringify(state.positions),
      JSON.stringify(state.uncertaintyAreas),
      JSON.stringify(state.influenceHistory),
      state.lastUpdatedAt
    );
  }
}
```

- [ ] **Step 4: Write `SQLiteUserSocialProfileRepository.ts`**

```typescript
import { inject, injectable } from 'inversify';

import type {
  PatternSignal,
  SocialSignal,
  UserSocialProfile,
} from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { UserSocialProfileRepository } from '@/domain/repositories/UserSocialProfileRepository';

interface ProfileRow {
  chat_id: number;
  user_id: number;
  username: string | null;
  affinity_score: number;
  labels_json: string;
  patterns_json: string;
  grudges_json: string;
  trust_level: string;
  preferred_distance: string;
  communication_style: string;
  conflict_style: string;
  preferred_tone: string;
  interests_json: string;
  updated_at: string;
}

function toProfile(row: ProfileRow): UserSocialProfile {
  return {
    userId: row.user_id,
    chatId: row.chat_id,
    username: row.username,
    affinityScore: row.affinity_score as UserSocialProfile['affinityScore'],
    labels: JSON.parse(row.labels_json) as SocialSignal[],
    patterns: JSON.parse(row.patterns_json) as PatternSignal[],
    grudges: JSON.parse(row.grudges_json) as SocialSignal[],
    trustLevel: row.trust_level as UserSocialProfile['trustLevel'],
    preferredDistance:
      row.preferred_distance as UserSocialProfile['preferredDistance'],
    communicationStyle: row.communication_style,
    conflictStyle: row.conflict_style,
    preferredTone: row.preferred_tone,
    interests: JSON.parse(row.interests_json) as string[],
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SQLiteUserSocialProfileRepository
  implements UserSocialProfileRepository
{
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async findByChatAndUser(
    chatId: number,
    userId: number
  ): Promise<UserSocialProfile | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<ProfileRow>(
      'SELECT * FROM user_social_profiles WHERE chat_id = ? AND user_id = ?',
      chatId,
      userId
    );
    return row ? toProfile(row) : undefined;
  }

  async findByChat(chatId: number): Promise<UserSocialProfile[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<ProfileRow>(
      'SELECT * FROM user_social_profiles WHERE chat_id = ? ORDER BY user_id',
      chatId
    );
    return rows.map(toProfile);
  }

  async upsert(profile: UserSocialProfile): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT INTO user_social_profiles
        (chat_id, user_id, username, affinity_score, labels_json, patterns_json, grudges_json, trust_level, preferred_distance, communication_style, conflict_style, preferred_tone, interests_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, user_id) DO UPDATE SET
         username=excluded.username,
         affinity_score=excluded.affinity_score,
         labels_json=excluded.labels_json,
         patterns_json=excluded.patterns_json,
         grudges_json=excluded.grudges_json,
         trust_level=excluded.trust_level,
         preferred_distance=excluded.preferred_distance,
         communication_style=excluded.communication_style,
         conflict_style=excluded.conflict_style,
         preferred_tone=excluded.preferred_tone,
         interests_json=excluded.interests_json,
         updated_at=excluded.updated_at`,
      profile.chatId,
      profile.userId,
      profile.username,
      profile.affinityScore,
      JSON.stringify(profile.labels),
      JSON.stringify(profile.patterns),
      JSON.stringify(profile.grudges),
      profile.trustLevel,
      profile.preferredDistance,
      profile.communicationStyle,
      profile.conflictStyle,
      profile.preferredTone,
      JSON.stringify(profile.interests),
      profile.updatedAt
    );
  }
}
```

- [ ] **Step 5: Write `SQLiteTruthRepository.ts`**

```typescript
import { inject, injectable } from 'inversify';

import type { BotTruth } from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type {
  NewTruth,
  TruthRepository,
} from '@/domain/repositories/TruthRepository';

interface TruthRow {
  id: number;
  chat_id: number;
  text: string;
  source_message_ids_json: string;
  confidence: number;
  related_truth_ids_json: string;
  contradicts_truth_ids_json: string;
  status: string;
  created_at: string;
}

function toTruth(row: TruthRow): BotTruth {
  return {
    id: row.id,
    chatId: row.chat_id,
    text: row.text,
    sourceMessageIds: JSON.parse(row.source_message_ids_json) as number[],
    confidence: row.confidence,
    relatedTruthIds: JSON.parse(row.related_truth_ids_json) as number[],
    contradictsTruthIds: JSON.parse(
      row.contradicts_truth_ids_json
    ) as number[],
    status: row.status as BotTruth['status'],
    createdAt: row.created_at,
  };
}

@injectable()
export class SQLiteTruthRepository implements TruthRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async add(truth: NewTruth): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `INSERT INTO bot_truths
        (chat_id, text, source_message_ids_json, confidence, related_truth_ids_json, contradicts_truth_ids_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      truth.chatId,
      truth.text,
      JSON.stringify(truth.sourceMessageIds),
      truth.confidence,
      JSON.stringify(truth.relatedTruthIds),
      JSON.stringify(truth.contradictsTruthIds),
      truth.status,
      truth.createdAt
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async findById(id: number): Promise<BotTruth | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<TruthRow>(
      'SELECT * FROM bot_truths WHERE id = ?',
      id
    );
    return row ? toTruth(row) : undefined;
  }

  async findByChatId(chatId: number): Promise<BotTruth[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<TruthRow>(
      'SELECT * FROM bot_truths WHERE chat_id = ? ORDER BY id',
      chatId
    );
    return rows.map(toTruth);
  }

  async update(truth: BotTruth): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE bot_truths SET
        text=?, source_message_ids_json=?, confidence=?, related_truth_ids_json=?, contradicts_truth_ids_json=?, status=?
       WHERE id = ?`,
      truth.text,
      JSON.stringify(truth.sourceMessageIds),
      truth.confidence,
      JSON.stringify(truth.relatedTruthIds),
      JSON.stringify(truth.contradictsTruthIds),
      truth.status,
      truth.id
    );
  }
}
```

> Note: `db.run` returns the underlying `sqlite` `RunResult` whose `lastID` holds the autoincrement id. The `SqlDatabase.run` signature in `DbProvider.ts` types it as `Promise<unknown>`, so the cast `as { lastID?: number }` is intentional and matches the project's existing pattern of narrowing untyped driver results.

- [ ] **Step 6: Write the failing test `test/behaviorStateRepositories.test.ts`**

```typescript
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLitePersonalityStateRepository } from '../src/infrastructure/persistence/sqlite/SQLitePersonalityStateRepository';
import { SQLitePoliticalStateRepository } from '../src/infrastructure/persistence/sqlite/SQLitePoliticalStateRepository';
import { SQLiteTruthRepository } from '../src/infrastructure/persistence/sqlite/SQLiteTruthRepository';
import { SQLiteUserSocialProfileRepository } from '../src/infrastructure/persistence/sqlite/SQLiteUserSocialProfileRepository';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { parseDatabaseUrl } from '../src/utils/database';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => {
      const logger = {
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return logger;
        },
      };
      return logger;
    },
  }) as unknown as LoggerFactory;

let personalityRepo: SQLitePersonalityStateRepository;
let politicalRepo: SQLitePoliticalStateRepository;
let profileRepo: SQLiteUserSocialProfileRepository;
let truthRepo: SQLiteTruthRepository;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-state-'));
  const dbFile = path.join(dir, 'test.db');
  process.env.DATABASE_URL = `file://${dbFile}`;
  const env = new TestEnvService();
  const filename = parseDatabaseUrl(env.env.DATABASE_URL);
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
  `);
  await db.exec(
    readFileSync(path.join('migrations', '015_create_behavior_tables.up.sql'), 'utf8')
  );
  await db.run('INSERT INTO chats (chat_id) VALUES (1)');
  await db.run('INSERT INTO users (id, username) VALUES (10, ?)', 'alice');
  await db.close();

  const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
  personalityRepo = new SQLitePersonalityStateRepository(provider);
  politicalRepo = new SQLitePoliticalStateRepository(provider);
  profileRepo = new SQLiteUserSocialProfileRepository(provider);
  truthRepo = new SQLiteTruthRepository(provider);
});

describe('behavior state repositories', () => {
  it('round-trips a personality state', async () => {
    const now = '2026-05-29T00:00:00.000Z';
    await personalityRepo.upsert({
      chatId: 1,
      identityNotes: ['curious'],
      values: ['honesty'],
      speechStyle: { tone: 'dry', humor: 'sarcastic', verbosity: 'short', formality: 'low' },
      socialHabits: ['lurks'],
      recurringThemes: ['cats'],
      lastUpdatedAt: now,
    });
    const loaded = await personalityRepo.findByChatId(1);
    expect(loaded?.values).toEqual(['honesty']);
    expect(loaded?.speechStyle.verbosity).toBe('short');
  });

  it('returns undefined for a missing personality state (neutral blank slate)', async () => {
    expect(await personalityRepo.findByChatId(999)).toBeUndefined();
  });

  it('round-trips a political state with positions', async () => {
    const now = '2026-05-29T00:00:00.000Z';
    await politicalRepo.upsert({
      chatId: 1,
      ideologySummary: 'leans communitarian',
      positions: [
        {
          id: 1,
          topic: 'taxes',
          stance: 'progressive',
          intensity: 'moderate',
          confidence: 0.6,
          status: 'active',
          evidenceMessageIds: [5],
          opposingEvidenceMessageIds: [],
          origin: 'chat_discussion',
          updatedAt: now,
        },
      ],
      uncertaintyAreas: ['trade'],
      influenceHistory: [],
      lastUpdatedAt: now,
    });
    const loaded = await politicalRepo.findByChatId(1);
    expect(loaded?.positions[0]?.topic).toBe('taxes');
    expect(loaded?.uncertaintyAreas).toEqual(['trade']);
  });

  it('round-trips a user social profile', async () => {
    const now = '2026-05-29T00:00:00.000Z';
    await profileRepo.upsert({
      userId: 10,
      chatId: 1,
      username: 'alice',
      affinityScore: -2,
      labels: [{ text: 'toxic', evidenceMessageIds: [3], status: 'active' }],
      patterns: [
        { polarity: 'negative', text: 'derails threads', evidenceMessageIds: [4], status: 'active' },
      ],
      grudges: [],
      trustLevel: 'low',
      preferredDistance: 'cold',
      communicationStyle: 'terse',
      conflictStyle: 'aggressive',
      preferredTone: 'blunt',
      interests: ['politics'],
      updatedAt: now,
    });
    const loaded = await profileRepo.findByChatAndUser(1, 10);
    expect(loaded?.affinityScore).toBe(-2);
    expect(loaded?.patterns[0]?.polarity).toBe('negative');
    expect((await profileRepo.findByChat(1)).length).toBe(1);
  });

  it('adds and reads truths, including contradictory ones', async () => {
    const now = '2026-05-29T00:00:00.000Z';
    const id1 = await truthRepo.add({
      chatId: 1,
      text: 'pizza is best',
      sourceMessageIds: [1],
      confidence: 0.7,
      relatedTruthIds: [],
      contradictsTruthIds: [],
      status: 'fresh',
      createdAt: now,
    });
    const id2 = await truthRepo.add({
      chatId: 1,
      text: 'sushi is best',
      sourceMessageIds: [2],
      confidence: 0.7,
      relatedTruthIds: [],
      contradictsTruthIds: [id1],
      status: 'fresh',
      createdAt: now,
    });
    expect(id2).toBeGreaterThan(id1);
    const all = await truthRepo.findByChatId(1);
    expect(all.length).toBe(2);

    const t2 = await truthRepo.findById(id2);
    expect(t2).toBeTruthy();
    if (t2) {
      t2.status = 'stable';
      await truthRepo.update(t2);
    }
    expect((await truthRepo.findById(id2))?.status).toBe('stable');
  });
});
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test test/behaviorStateRepositories.test.ts`
Expected: PASS (5 tests). If `add` returns 0, confirm the `lastID` cast in `SQLiteTruthRepository`.

- [ ] **Step 8: Lint, format, type-check, commit**

```bash
pnpm lint:fix && pnpm format:fix && pnpm type:check
git add src/domain/repositories/PersonalityStateRepository.ts src/domain/repositories/PoliticalStateRepository.ts src/domain/repositories/UserSocialProfileRepository.ts src/domain/repositories/TruthRepository.ts src/infrastructure/persistence/sqlite/SQLitePersonalityStateRepository.ts src/infrastructure/persistence/sqlite/SQLitePoliticalStateRepository.ts src/infrastructure/persistence/sqlite/SQLiteUserSocialProfileRepository.ts src/infrastructure/persistence/sqlite/SQLiteTruthRepository.ts test/behaviorStateRepositories.test.ts
git commit -m "feat(behavior): add personality/political/profile/truth repositories"
```

---

## Task 10: Event repositories (behavior_events, ai_error_events)

**Files:**
- Create: `src/domain/repositories/BehaviorEventRepository.ts`, `AiErrorEventRepository.ts`
- Create: `src/infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository.ts`, `SQLiteAiErrorEventRepository.ts`
- Test: `test/behaviorEventRepositories.test.ts`

- [ ] **Step 1: Write the two interfaces**

```typescript
// src/domain/repositories/BehaviorEventRepository.ts
import type {
  BehaviorEventEntity,
  NewBehaviorEvent,
} from '@/domain/entities/BehaviorEventEntity';

export interface BehaviorEventRepository {
  insert(event: NewBehaviorEvent): Promise<number>;
  findById(id: number): Promise<BehaviorEventEntity | undefined>;
  findByChatId(chatId: number): Promise<BehaviorEventEntity[]>;
}

export const BEHAVIOR_EVENT_REPOSITORY_ID = Symbol('BehaviorEventRepository');
```

```typescript
// src/domain/repositories/AiErrorEventRepository.ts
import type {
  AiErrorEventEntity,
  NewAiErrorEvent,
} from '@/domain/entities/AiErrorEventEntity';

export interface AiErrorEventRepository {
  insert(event: NewAiErrorEvent): Promise<number>;
  findById(id: number): Promise<AiErrorEventEntity | undefined>;
}

export const AI_ERROR_EVENT_REPOSITORY_ID = Symbol('AiErrorEventRepository');
```

- [ ] **Step 2: Write `SQLiteBehaviorEventRepository.ts`**

```typescript
import { inject, injectable } from 'inversify';

import type {
  BehaviorEventEntity,
  NewBehaviorEvent,
} from '@/domain/entities/BehaviorEventEntity';
import type { BehaviorEventRepository } from '@/domain/repositories/BehaviorEventRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';

interface BehaviorEventRow {
  id: number;
  chat_id: number;
  schema_version: string;
  gate_reason: string | null;
  gate_confidence: number | null;
  gate_state_impact_risk: string | null;
  trigger_message_ids_json: string;
  context_message_ids_json: string;
  model_slot: string;
  selected_model: string;
  escalated: number;
  escalation_reason: string | null;
  actions_json: string;
  action_results_json: string;
  state_patches_json: string;
  patch_results_json: string;
  confidence: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
}

function toEntity(row: BehaviorEventRow): BehaviorEventEntity {
  return {
    id: row.id,
    chatId: row.chat_id,
    schemaVersion: row.schema_version,
    gateReason: row.gate_reason,
    gateConfidence: row.gate_confidence,
    gateStateImpactRisk: row.gate_state_impact_risk,
    triggerMessageIdsJson: row.trigger_message_ids_json,
    contextMessageIdsJson: row.context_message_ids_json,
    modelSlot: row.model_slot,
    selectedModel: row.selected_model,
    escalated: row.escalated === 1,
    escalationReason: row.escalation_reason,
    actionsJson: row.actions_json,
    actionResultsJson: row.action_results_json,
    statePatchesJson: row.state_patches_json,
    patchResultsJson: row.patch_results_json,
    confidence: row.confidence,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}

@injectable()
export class SQLiteBehaviorEventRepository implements BehaviorEventRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async insert(event: NewBehaviorEvent): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `INSERT INTO behavior_events
        (chat_id, schema_version, gate_reason, gate_confidence, gate_state_impact_risk, trigger_message_ids_json, context_message_ids_json, model_slot, selected_model, escalated, escalation_reason, actions_json, action_results_json, state_patches_json, patch_results_json, confidence, prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.chatId,
      event.schemaVersion,
      event.gateReason,
      event.gateConfidence,
      event.gateStateImpactRisk,
      event.triggerMessageIdsJson,
      event.contextMessageIdsJson,
      event.modelSlot,
      event.selectedModel,
      event.escalated ? 1 : 0,
      event.escalationReason,
      event.actionsJson,
      event.actionResultsJson,
      event.statePatchesJson,
      event.patchResultsJson,
      event.confidence,
      event.promptTokens,
      event.completionTokens,
      event.totalTokens,
      event.latencyMs,
      event.createdAt
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async findById(id: number): Promise<BehaviorEventEntity | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<BehaviorEventRow>(
      'SELECT * FROM behavior_events WHERE id = ?',
      id
    );
    return row ? toEntity(row) : undefined;
  }

  async findByChatId(chatId: number): Promise<BehaviorEventEntity[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<BehaviorEventRow>(
      'SELECT * FROM behavior_events WHERE chat_id = ? ORDER BY id',
      chatId
    );
    return rows.map(toEntity);
  }
}
```

- [ ] **Step 3: Write `SQLiteAiErrorEventRepository.ts`**

```typescript
import { inject, injectable } from 'inversify';

import type {
  AiErrorEventEntity,
  NewAiErrorEvent,
} from '@/domain/entities/AiErrorEventEntity';
import type { AiErrorEventRepository } from '@/domain/repositories/AiErrorEventRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';

interface AiErrorEventRow {
  id: number;
  chat_id: number | null;
  source: string;
  severity: string;
  error_code: string;
  message: string;
  component: string;
  operation: string;
  input_ref_json: string | null;
  output_ref_json: string | null;
  stack_hash: string | null;
  fix_hint: string;
  status: string;
  created_at: string;
}

function toEntity(row: AiErrorEventRow): AiErrorEventEntity {
  return {
    id: row.id,
    chatId: row.chat_id,
    source: row.source,
    severity: row.severity as AiErrorEventEntity['severity'],
    errorCode: row.error_code,
    message: row.message,
    component: row.component,
    operation: row.operation,
    inputRefJson: row.input_ref_json,
    outputRefJson: row.output_ref_json,
    stackHash: row.stack_hash,
    fixHint: row.fix_hint,
    status: row.status as AiErrorEventEntity['status'],
    createdAt: row.created_at,
  };
}

@injectable()
export class SQLiteAiErrorEventRepository implements AiErrorEventRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async insert(event: NewAiErrorEvent): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `INSERT INTO ai_error_events
        (chat_id, source, severity, error_code, message, component, operation, input_ref_json, output_ref_json, stack_hash, fix_hint, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.chatId,
      event.source,
      event.severity,
      event.errorCode,
      event.message,
      event.component,
      event.operation,
      event.inputRefJson,
      event.outputRefJson,
      event.stackHash,
      event.fixHint,
      event.status,
      event.createdAt
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async findById(id: number): Promise<AiErrorEventEntity | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<AiErrorEventRow>(
      'SELECT * FROM ai_error_events WHERE id = ?',
      id
    );
    return row ? toEntity(row) : undefined;
  }
}
```

- [ ] **Step 4: Write the failing test `test/behaviorEventRepositories.test.ts`**

```typescript
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteAiErrorEventRepository } from '../src/infrastructure/persistence/sqlite/SQLiteAiErrorEventRepository';
import { SQLiteBehaviorEventRepository } from '../src/infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { parseDatabaseUrl } from '../src/utils/database';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => {
      const logger = {
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return logger;
        },
      };
      return logger;
    },
  }) as unknown as LoggerFactory;

let behaviorRepo: SQLiteBehaviorEventRepository;
let errorRepo: SQLiteAiErrorEventRepository;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-events-'));
  const dbFile = path.join(dir, 'test.db');
  process.env.DATABASE_URL = `file://${dbFile}`;
  const env = new TestEnvService();
  const filename = parseDatabaseUrl(env.env.DATABASE_URL);
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
  `);
  await db.exec(
    readFileSync(path.join('migrations', '015_create_behavior_tables.up.sql'), 'utf8')
  );
  await db.run('INSERT INTO chats (chat_id) VALUES (1)');
  await db.close();

  const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
  behaviorRepo = new SQLiteBehaviorEventRepository(provider);
  errorRepo = new SQLiteAiErrorEventRepository(provider);
});

describe('behavior event repositories', () => {
  it('inserts and reads a behavior event, preserving the escalated boolean', async () => {
    const id = await behaviorRepo.insert({
      chatId: 1,
      schemaVersion: 'v1',
      gateReason: 'conflict',
      gateConfidence: 0.8,
      gateStateImpactRisk: 'high',
      triggerMessageIdsJson: '[10]',
      contextMessageIdsJson: '[9]',
      modelSlot: 'behaviorDecision',
      selectedModel: 'gpt-5.5',
      escalated: true,
      escalationReason: 'high_risk',
      actionsJson: '[]',
      actionResultsJson: '[]',
      statePatchesJson: '[]',
      patchResultsJson: '[]',
      confidence: 0.9,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      latencyMs: 543,
      createdAt: '2026-05-29T00:00:00.000Z',
    });
    const loaded = await behaviorRepo.findById(id);
    expect(loaded?.escalated).toBe(true);
    expect(loaded?.modelSlot).toBe('behaviorDecision');
    expect((await behaviorRepo.findByChatId(1)).length).toBe(1);
  });

  it('inserts and reads an AI error event with a null chatId', async () => {
    const id = await errorRepo.insert({
      chatId: null,
      source: 'behavior_decision_parse',
      severity: 'error',
      errorCode: 'INVALID_JSON',
      message: 'could not parse',
      component: 'ChatGPTService',
      operation: 'decideBehavior',
      inputRefJson: null,
      outputRefJson: '{"raw":"..."}',
      stackHash: 'abc123',
      fixHint: 'retry with stricter schema',
      status: 'open',
      createdAt: '2026-05-29T00:00:00.000Z',
    });
    const loaded = await errorRepo.findById(id);
    expect(loaded?.chatId).toBeNull();
    expect(loaded?.errorCode).toBe('INVALID_JSON');
    expect(loaded?.status).toBe('open');
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test test/behaviorEventRepositories.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Lint, format, type-check, commit**

```bash
pnpm lint:fix && pnpm format:fix && pnpm type:check
git add src/domain/repositories/BehaviorEventRepository.ts src/domain/repositories/AiErrorEventRepository.ts src/infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository.ts src/infrastructure/persistence/sqlite/SQLiteAiErrorEventRepository.ts test/behaviorEventRepositories.test.ts
git commit -m "feat(behavior): add behavior and AI error event repositories"
```

---

## Task 11: Register the six repositories in the DI container

**Files:**
- Modify: `src/container/repositories.ts`

- [ ] **Step 1: Add imports** at the top of `src/container/repositories.ts` (after the existing imports, keeping alphabetical-ish grouping consistent with the file)

```typescript
import {
  AI_ERROR_EVENT_REPOSITORY_ID,
  type AiErrorEventRepository,
} from '../domain/repositories/AiErrorEventRepository';
import {
  BEHAVIOR_EVENT_REPOSITORY_ID,
  type BehaviorEventRepository,
} from '../domain/repositories/BehaviorEventRepository';
import {
  PERSONALITY_STATE_REPOSITORY_ID,
  type PersonalityStateRepository,
} from '../domain/repositories/PersonalityStateRepository';
import {
  POLITICAL_STATE_REPOSITORY_ID,
  type PoliticalStateRepository,
} from '../domain/repositories/PoliticalStateRepository';
import {
  TRUTH_REPOSITORY_ID,
  type TruthRepository,
} from '../domain/repositories/TruthRepository';
import {
  USER_SOCIAL_PROFILE_REPOSITORY_ID,
  type UserSocialProfileRepository,
} from '../domain/repositories/UserSocialProfileRepository';
import { SQLiteAiErrorEventRepository } from '../infrastructure/persistence/sqlite/SQLiteAiErrorEventRepository';
import { SQLiteBehaviorEventRepository } from '../infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository';
import { SQLitePersonalityStateRepository } from '../infrastructure/persistence/sqlite/SQLitePersonalityStateRepository';
import { SQLitePoliticalStateRepository } from '../infrastructure/persistence/sqlite/SQLitePoliticalStateRepository';
import { SQLiteTruthRepository } from '../infrastructure/persistence/sqlite/SQLiteTruthRepository';
import { SQLiteUserSocialProfileRepository } from '../infrastructure/persistence/sqlite/SQLiteUserSocialProfileRepository';
```

- [ ] **Step 2: Add bindings** inside the `register` function, after the existing `ChatConfigRepository` binding

```typescript
  container
    .bind<PersonalityStateRepository>(PERSONALITY_STATE_REPOSITORY_ID)
    .to(SQLitePersonalityStateRepository)
    .inSingletonScope();
  container
    .bind<PoliticalStateRepository>(POLITICAL_STATE_REPOSITORY_ID)
    .to(SQLitePoliticalStateRepository)
    .inSingletonScope();
  container
    .bind<UserSocialProfileRepository>(USER_SOCIAL_PROFILE_REPOSITORY_ID)
    .to(SQLiteUserSocialProfileRepository)
    .inSingletonScope();
  container
    .bind<TruthRepository>(TRUTH_REPOSITORY_ID)
    .to(SQLiteTruthRepository)
    .inSingletonScope();
  container
    .bind<BehaviorEventRepository>(BEHAVIOR_EVENT_REPOSITORY_ID)
    .to(SQLiteBehaviorEventRepository)
    .inSingletonScope();
  container
    .bind<AiErrorEventRepository>(AI_ERROR_EVENT_REPOSITORY_ID)
    .to(SQLiteAiErrorEventRepository)
    .inSingletonScope();
```

- [ ] **Step 3: Build to verify DI wiring compiles and resolves**

Run: `pnpm build`
Expected: build succeeds (RSBuild compiles `src/container.ts` and its imports without unresolved symbols).

- [ ] **Step 4: Type-check, lint, format, commit**

```bash
pnpm lint:fix && pnpm format:fix && pnpm type:check
git add src/container/repositories.ts
git commit -m "feat(behavior): register behavior repositories in DI container"
```

---

## Task 12: BehaviorDecisionValidator

**Files:**
- Create: `src/application/behavior/BehaviorDecisionValidator.ts` (interface + symbol + result types)
- Create: `src/application/behavior/DefaultBehaviorDecisionValidator.ts` (impl)
- Test: `test/BehaviorDecisionValidator.test.ts`

The validator parses raw AI output against `behaviorDecisionSchema`, then enforces semantic rules the JSON Schema cannot express, applying the spec's "drop only the invalid action" fallback. It does **not** mutate state.

Rules enforced:
- invalid JSON / schema → `{ ok: false }` with `errorCode: 'behavior_decision_validation'`.
- at most one `reply`, one `react`, one `ask_question` (keep the first of each type, drop extras).
- reply `text` non-empty and `<= maxReplyLength` (drop the reply action otherwise).
- `react.emoji` must be in the injected allowed set (drop the react action otherwise). The allowed set is decided in Plan 03; here it is constructor config.
- dropped actions are reported with reasons; surviving actions + all parsed patches are returned.

- [ ] **Step 1: Write `BehaviorDecisionValidator.ts`**

```typescript
import type { ServiceIdentifier } from 'inversify';

import type { BehaviorAction } from '@/domain/behavior/schemas/actions';
import type { BehaviorDecision } from '@/domain/behavior/schemas/decision';

export interface DroppedAction {
  action: BehaviorAction;
  reason: string;
}

export interface ValidBehaviorDecision {
  ok: true;
  decision: BehaviorDecision;
  droppedActions: DroppedAction[];
}

export interface InvalidBehaviorDecision {
  ok: false;
  errorCode: 'behavior_decision_validation';
  issues: string[];
}

export type BehaviorDecisionValidationResult =
  | ValidBehaviorDecision
  | InvalidBehaviorDecision;

export interface BehaviorDecisionValidator {
  validate(raw: unknown): BehaviorDecisionValidationResult;
}

export const BEHAVIOR_DECISION_VALIDATOR_ID = Symbol.for(
  'BehaviorDecisionValidator'
) as ServiceIdentifier<BehaviorDecisionValidator>;

export interface BehaviorDecisionValidatorConfig {
  maxReplyLength: number;
  allowedEmoji: readonly string[];
}
```

- [ ] **Step 2: Write the failing test `test/BehaviorDecisionValidator.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';

import { DefaultBehaviorDecisionValidator } from '../src/application/behavior/DefaultBehaviorDecisionValidator';

const config = { maxReplyLength: 20, allowedEmoji: ['👍', '👎'] };
const validator = new DefaultBehaviorDecisionValidator(config);

function decision(actions: unknown[]): unknown {
  return { confidence: 0.8, actions, statePatches: [], safetyNotes: [] };
}

describe('DefaultBehaviorDecisionValidator', () => {
  it('rejects non-object / invalid JSON shapes', () => {
    const result = validator.validate('not an object');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('behavior_decision_validation');
    }
  });

  it('accepts a valid decision with no drops', () => {
    const result = validator.validate(
      decision([{ type: 'reply', intent: 'banter', text: 'hi', replyTo: 'none' }])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(1);
      expect(result.droppedActions.length).toBe(0);
    }
  });

  it('drops a reply whose text exceeds maxReplyLength', () => {
    const result = validator.validate(
      decision([
        { type: 'reply', intent: 'banter', text: 'x'.repeat(50), replyTo: 'none' },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(0);
      expect(result.droppedActions[0]?.reason).toContain('length');
    }
  });

  it('drops an empty reply', () => {
    const result = validator.validate(
      decision([{ type: 'reply', intent: 'banter', text: '', replyTo: 'none' }])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(0);
    }
  });

  it('drops a react with a disallowed emoji', () => {
    const result = validator.validate(
      decision([{ type: 'react', intent: 'approval', emoji: '🔥', targetMessageId: 1 }])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(0);
      expect(result.droppedActions[0]?.reason).toContain('emoji');
    }
  });

  it('keeps the first action of a type and drops duplicates', () => {
    const result = validator.validate(
      decision([
        { type: 'reply', intent: 'banter', text: 'one', replyTo: 'none' },
        { type: 'reply', intent: 'argument', text: 'two', replyTo: 'none' },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(1);
      const reply = result.decision.actions[0];
      expect(reply?.type === 'reply' ? reply.text : '').toBe('one');
      expect(result.droppedActions[0]?.reason).toContain('duplicate');
    }
  });

  it('does not count summarize_thread against visible-action limits', () => {
    const result = validator.validate(
      decision([
        { type: 'summarize_thread', intent: 'compress_context', reason: 'long' },
        { type: 'reply', intent: 'support', text: 'ok', replyTo: 'none' },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(2);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test test/BehaviorDecisionValidator.test.ts`
Expected: FAIL — `Cannot find module '../src/application/behavior/DefaultBehaviorDecisionValidator'`.

- [ ] **Step 4: Write `DefaultBehaviorDecisionValidator.ts`**

```typescript
import { injectable } from 'inversify';

import type { BehaviorAction } from '@/domain/behavior/schemas/actions';
import type { BehaviorDecision } from '@/domain/behavior/schemas/decision';
import { behaviorDecisionSchema } from '@/domain/behavior/schemas/decision';

import type {
  BehaviorDecisionValidationResult,
  BehaviorDecisionValidator,
  BehaviorDecisionValidatorConfig,
  DroppedAction,
} from './BehaviorDecisionValidator';

@injectable()
export class DefaultBehaviorDecisionValidator
  implements BehaviorDecisionValidator
{
  constructor(private readonly config: BehaviorDecisionValidatorConfig) {}

  validate(raw: unknown): BehaviorDecisionValidationResult {
    const parsed = behaviorDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        errorCode: 'behavior_decision_validation',
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`
        ),
      };
    }

    const decision = parsed.data;
    const kept: BehaviorAction[] = [];
    const dropped: DroppedAction[] = [];
    const seenVisibleTypes = new Set<string>();

    for (const action of decision.actions) {
      const drop = (reason: string): void => {
        dropped.push({ action, reason });
      };

      switch (action.type) {
        case 'summarize_thread': {
          // Internal, not visible; never counts against per-type limits.
          kept.push(action);
          break;
        }
        case 'reply': {
          if (seenVisibleTypes.has('reply')) {
            drop('duplicate reply action dropped');
            break;
          }
          if (action.text.length === 0) {
            drop('reply text is empty');
            break;
          }
          if (action.text.length > this.config.maxReplyLength) {
            drop(`reply text exceeds max length ${this.config.maxReplyLength}`);
            break;
          }
          seenVisibleTypes.add('reply');
          kept.push(action);
          break;
        }
        case 'react': {
          if (seenVisibleTypes.has('react')) {
            drop('duplicate react action dropped');
            break;
          }
          if (!this.config.allowedEmoji.includes(action.emoji)) {
            drop(`emoji "${action.emoji}" not in allowed set`);
            break;
          }
          seenVisibleTypes.add('react');
          kept.push(action);
          break;
        }
        case 'ask_question': {
          if (seenVisibleTypes.has('ask_question')) {
            drop('duplicate ask_question action dropped');
            break;
          }
          if (action.text.length === 0) {
            drop('ask_question text is empty');
            break;
          }
          seenVisibleTypes.add('ask_question');
          kept.push(action);
          break;
        }
      }
    }

    const sanitized: BehaviorDecision = { ...decision, actions: kept };
    return { ok: true, decision: sanitized, droppedActions: dropped };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test test/BehaviorDecisionValidator.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Lint, format, type-check, commit**

```bash
pnpm lint:fix && pnpm format:fix && pnpm type:check
git add src/application/behavior/BehaviorDecisionValidator.ts src/application/behavior/DefaultBehaviorDecisionValidator.ts test/BehaviorDecisionValidator.test.ts
git commit -m "feat(behavior): add BehaviorDecisionValidator with per-action sanitization"
```

---

## Task 13: PatchPolicy (per-domain patch validation)

**Files:**
- Create: `src/application/behavior/PatchPolicy.ts` (interface + symbol + config + result types)
- Create: `src/application/behavior/DefaultPatchPolicy.ts` (impl)
- Test: `test/PatchPolicy.test.ts`

`PatchPolicy` evaluates a single patch (live or evolution) and returns an outcome. It is pure — no state mutation. Confidence thresholds and the hard-boundary term list are injected config (final values are decided in Plan 04); tests pass explicit values.

Outcomes: `accept` | `reject` | `to_uncertainty` | `downgrade` | `escalate`.

Rules (spec-derived):
- All patches require `evidence.messageIds.length >= 1`; otherwise `reject` ("missing evidence").
- `politics.add_position` with `requestedIntensity` `strong`/`radical` and `evidence.confidence < politicalStrongMinConfidence` → `to_uncertainty`.
- `politics.add_position` with `evidence.confidence < politicalWeakMaxConfidence` → `to_uncertainty` (weak claims go to uncertainty, not positions).
- Any political/personality patch whose text matches a hard-boundary term → `reject` ("hard boundary").
- `politics.add_position` requesting `radical` with sufficient confidence and no boundary hit → `escalate` (stronger-model review before application).
- `personality.add_signal` with `evidence.confidence < personalityMinConfidence` → `reject` ("low confidence").
- everything else with valid evidence → `accept`.

- [ ] **Step 1: Write `PatchPolicy.ts`**

```typescript
import type { ServiceIdentifier } from 'inversify';

import type { LiveStatePatch } from '@/domain/behavior/schemas/patches';
import type { EvolutionPatch } from '@/domain/behavior/schemas/patches';

export type AnyPatch = LiveStatePatch | EvolutionPatch;

export type PatchOutcome =
  | 'accept'
  | 'reject'
  | 'to_uncertainty'
  | 'downgrade'
  | 'escalate';

export interface PatchDecision {
  outcome: PatchOutcome;
  reason: string;
}

export interface PatchPolicy {
  evaluate(patch: AnyPatch): PatchDecision;
}

export interface PatchPolicyConfig {
  personalityMinConfidence: number;
  politicalWeakMaxConfidence: number;
  politicalStrongMinConfidence: number;
  hardBoundaryTerms: readonly string[];
}

export const PATCH_POLICY_ID = Symbol.for(
  'PatchPolicy'
) as ServiceIdentifier<PatchPolicy>;
```

- [ ] **Step 2: Write the failing test `test/PatchPolicy.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';

import { DefaultPatchPolicy } from '../src/application/behavior/DefaultPatchPolicy';
import type { AnyPatch } from '../src/application/behavior/PatchPolicy';

const policy = new DefaultPatchPolicy({
  personalityMinConfidence: 0.5,
  politicalWeakMaxConfidence: 0.4,
  politicalStrongMinConfidence: 0.7,
  hardBoundaryTerms: ['exterminate'],
});

const ev = (confidence: number, ids: number[] = [1]) => ({
  messageIds: ids,
  summary: 's',
  confidence,
});

describe('DefaultPatchPolicy', () => {
  it('rejects any patch with no evidence message ids', () => {
    const patch: AnyPatch = {
      type: 'user.add_label',
      userId: 1,
      label: 'funny',
      evidence: ev(0.9, []),
    };
    expect(policy.evaluate(patch).outcome).toBe('reject');
  });

  it('accepts a well-evidenced affinity adjustment', () => {
    const patch: AnyPatch = {
      type: 'user.adjust_affinity',
      userId: 1,
      delta: 1,
      evidence: ev(0.6),
    };
    expect(policy.evaluate(patch).outcome).toBe('accept');
  });

  it('routes a weak political claim to uncertainty', () => {
    const patch: AnyPatch = {
      type: 'politics.add_position',
      topic: 'trade',
      stance: 'mild protectionism',
      requestedIntensity: 'weak',
      evidence: ev(0.3),
    };
    expect(policy.evaluate(patch).outcome).toBe('to_uncertainty');
  });

  it('routes a strong claim with insufficient confidence to uncertainty', () => {
    const patch: AnyPatch = {
      type: 'politics.add_position',
      topic: 'taxes',
      stance: 'sharply higher',
      requestedIntensity: 'strong',
      evidence: ev(0.5),
    };
    expect(policy.evaluate(patch).outcome).toBe('to_uncertainty');
  });

  it('escalates a confident radical position for stronger-model review', () => {
    const patch: AnyPatch = {
      type: 'politics.add_position',
      topic: 'reform',
      stance: 'total overhaul',
      requestedIntensity: 'radical',
      evidence: ev(0.9),
    };
    expect(policy.evaluate(patch).outcome).toBe('escalate');
  });

  it('rejects a patch hitting a hard-boundary term', () => {
    const patch: AnyPatch = {
      type: 'politics.add_position',
      topic: 'group',
      stance: 'we should exterminate them',
      requestedIntensity: 'radical',
      evidence: ev(0.95),
    };
    expect(policy.evaluate(patch).outcome).toBe('reject');
  });

  it('rejects a low-confidence personality signal', () => {
    const patch: AnyPatch = {
      type: 'personality.add_signal',
      area: 'values',
      polarity: 'reinforce',
      text: 'values privacy',
      evidence: ev(0.2),
    };
    expect(policy.evaluate(patch).outcome).toBe('reject');
  });

  it('accepts a confident personality signal', () => {
    const patch: AnyPatch = {
      type: 'personality.add_signal',
      area: 'values',
      polarity: 'reinforce',
      text: 'values privacy',
      evidence: ev(0.8),
    };
    expect(policy.evaluate(patch).outcome).toBe('accept');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test test/PatchPolicy.test.ts`
Expected: FAIL — `Cannot find module '../src/application/behavior/DefaultPatchPolicy'`.

- [ ] **Step 4: Write `DefaultPatchPolicy.ts`**

```typescript
import { injectable } from 'inversify';

import type {
  AnyPatch,
  PatchDecision,
  PatchPolicy,
  PatchPolicyConfig,
} from './PatchPolicy';

@injectable()
export class DefaultPatchPolicy implements PatchPolicy {
  constructor(private readonly config: PatchPolicyConfig) {}

  evaluate(patch: AnyPatch): PatchDecision {
    if (patch.evidence.messageIds.length === 0) {
      return { outcome: 'reject', reason: 'missing evidence message ids' };
    }

    const boundaryHit = this.hitsHardBoundary(this.patchText(patch));
    if (boundaryHit) {
      return { outcome: 'reject', reason: 'hard boundary term in patch text' };
    }

    switch (patch.type) {
      case 'politics.add_position': {
        const { confidence } = patch.evidence;
        const strong =
          patch.requestedIntensity === 'strong' ||
          patch.requestedIntensity === 'radical';
        if (confidence < this.config.politicalWeakMaxConfidence) {
          return { outcome: 'to_uncertainty', reason: 'weak political claim' };
        }
        if (strong && confidence < this.config.politicalStrongMinConfidence) {
          return {
            outcome: 'to_uncertainty',
            reason: 'strong claim lacks confidence',
          };
        }
        if (patch.requestedIntensity === 'radical') {
          return {
            outcome: 'escalate',
            reason: 'radical position requires stronger-model review',
          };
        }
        return { outcome: 'accept', reason: 'political position accepted' };
      }
      case 'personality.add_signal': {
        if (patch.evidence.confidence < this.config.personalityMinConfidence) {
          return { outcome: 'reject', reason: 'low-confidence personality signal' };
        }
        return { outcome: 'accept', reason: 'personality signal accepted' };
      }
      default:
        return { outcome: 'accept', reason: 'patch accepted' };
    }
  }

  private patchText(patch: AnyPatch): string {
    switch (patch.type) {
      case 'user.add_label':
        return patch.label;
      case 'user.add_pattern':
        return patch.text;
      case 'user.add_grudge':
        return patch.text;
      case 'user.contest_profile_signal':
        return patch.target.text;
      case 'truth.add':
        return patch.text;
      case 'truth.contest':
        return patch.counterText;
      case 'truth.revise':
        return patch.revisedText;
      case 'personality.add_signal':
        return patch.text;
      case 'politics.add_position':
        return `${patch.topic} ${patch.stance}`;
      case 'politics.add_uncertainty':
        return `${patch.topic} ${patch.summary}`;
      default:
        return '';
    }
  }

  private hitsHardBoundary(text: string): boolean {
    const lower = text.toLowerCase();
    return this.config.hardBoundaryTerms.some((term) =>
      lower.includes(term.toLowerCase())
    );
  }
}
```

> Note: the `patchText` `default` branch covers patch types with no free text (`user.adjust_affinity`, `truth.reinforce`, `politics.adjust_position`), returning `''` so the boundary scan is a no-op for them.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test test/PatchPolicy.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Full suite, lint, format, type-check, commit**

```bash
pnpm test
pnpm lint:fix && pnpm format:fix && pnpm type:check
git add src/application/behavior/PatchPolicy.ts src/application/behavior/DefaultPatchPolicy.ts test/PatchPolicy.test.ts
git commit -m "feat(behavior): add per-domain PatchPolicy"
```

> `PatchPolicy` and `BehaviorDecisionValidator` are intentionally **not** bound in the DI container in Phase 1: both require runtime config (`maxReplyLength`/`allowedEmoji`, confidence thresholds) whose values are decided in Plans 03/04. They are wired into the container via an `EnvService`-backed factory in those plans, alongside the model-slot config changes. Leaving them unbound here keeps Phase 1 free of provisional magic numbers.

---

## Phase 1 Completion Checklist

- [ ] All 13 tasks committed.
- [ ] `pnpm test` green (new files: `behaviorJsonSchema`, `behaviorMigration015`, `behaviorStateRepositories`, `behaviorEventRepositories`, `BehaviorDecisionValidator`, `PatchPolicy`).
- [ ] `pnpm type:check` clean; `pnpm lint` clean; `pnpm format` clean.
- [ ] `pnpm build` succeeds (DI container resolves the six new repositories).
- [ ] Legacy answer flow untouched: no changes to `ChatGPTService`, `DefaultChatResponder`, `users.attitude`, or existing migrations.
- [ ] Update the tracker: mark Plan 01 done, note any discoveries that should refine Plan 02.

## Out of scope for Phase 1 (handed to later plans)

- `StatePatchApplicator` (affinity summation/clamping, contest deactivation, derived-field recompute, best-effort independent application) → Plan 03/04, where patches are actually applied.
- Model-slot config changes (`behaviorDecision`, `triggerGate`, `stateEvolution`, `summarization`, `errorRepair`) replacing `ask`/`summary`/`interest` → Plan 02.
- DI binding + config wiring for `BehaviorDecisionValidator` and `PatchPolicy` → Plans 02/03/04.
- New prompt files, the gate, `decideBehavior`, executor, rate limiter, state-evolution pass, and the destructive `users.attitude` migration → Plans 02–05.
