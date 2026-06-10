# Carl Fact Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a conservative Telegram fact checker for Carl that batches new chat messages, verifies factual mistakes, stores findings with sources, and publishes compact Russian Telegram HTML output.

**Architecture:** Add a separate `fact-checking` application area with its own schemas, repositories, reasoning service, source search service, pipeline, notifier, stats service, scheduler, and manual job. The provider-neutral AI gateway already exists in the codebase as `AiGateway` (interface `src/application/interfaces/ai/AiGateway.ts`, id `AI_GATEWAY_ID`, implementation `OpenAiSdkGateway`), landed in commit `40fca7b "[codex] Refactor AI access behind provider-neutral gateway (#287)"`. Fact-checking services consume `AiGateway` directly. Reuse the existing Clean Architecture boundaries, Inversify bindings, SQLite migrations, `PromptDirector`/`PromptBuilder`, strict structured output pattern, `ChatMessenger`, and `MessageService`.

**Tech Stack:** TypeScript, Inversify, SQLite, node-cron, `AiGateway` (provider-neutral, OpenAI-backed), chat completions structured outputs (`AiGateway.parseChatCompletion`), OpenAI Responses web search (`AiGateway.createResponse`), Zod, Vitest, grammY Telegram HTML.

> **Codebase alignment (read first).** This plan was written against an earlier draft that assumed an `OpenAiGateway`. The current code uses a provider-neutral gateway. Apply these facts throughout:
>
> - Inject `AI_GATEWAY_ID` (type `AiGateway`) from `@/application/interfaces/ai/AiGateway`. There is no `OpenAiGateway`/`OPEN_AI_GATEWAY_ID`.
> - `AiGateway.parseChatCompletion<T>({ model, messages, responseFormat, parse })` returns `AiParsedResult<T> = { parsed: T | null; model; usage: AiUsage; raw: unknown }`. The structured-output schema is passed as `responseFormat` (an `AiResponseFormatSchema`), **not** `jsonSchema`.
> - `AiGateway.createResponse({ model, input, tools })` returns `AiResponseResult = { outputText: string; usage: AiUsage; raw: unknown }`.
> - `AiUsage = { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null }`.
> - Build OpenAI strict schemas with `toOpenAiJsonSchema(zodSchema, name)` from `@/domain/behavior/schemas/jsonSchema`; it returns `AiResponseFormatSchema = { name; strict: true; schema }` and already strips unsupported keywords (`minimum`, `maximum`, length, pattern, etc.).
> - `AiModelId` is just `string`. Cast literal model ids `as AiModelId` (not `as ChatModel`).
> - The reference AI service to mirror is `DefaultBehaviorAiService` (`src/application/behavior/DefaultBehaviorAiService.ts`), which shows the inject set, `toAiMessages` mapping from `PromptMessage[]`, escalation loop, and `LOG_PROMPTS` file logging via `prompts.log`.
> - `ChatRepository.findById(chatId)` returns `Promise<ChatEntity | undefined>` (**not** `| null`); guard with optional chaining (`chat?.username ?? null`).
> - `ChatMessenger.sendMessage(chatId, text, extra?)` forwards `extra` straight to grammY `bot.api.sendMessage`; pass `parse_mode`, `reply_parameters`, and `link_preview_options` inside `extra`. It returns `Promise<number | null>`.
> - `ChatApprovalService.listAll()` returns `ChatAccessEntity[]` where `status: 'pending' | 'approved' | 'banned'`; filter `status === 'approved'` for the sweep.
> - `MainService.stop(reason: string): void` is synchronous and currently stops only the messenger; add the fact-check scheduler stop alongside it.
> - The next free migration number is **022** (`021_add_reply_target_fields` already exists).

---

## Scope Check

This is one product feature with several internal layers. Keep it in one plan because every layer is needed for a working MVP, but implement it in vertical slices with tests after each slice.

No prerequisite plan remains. The provider-neutral AI gateway (`AiGateway` / `AI_GATEWAY_ID` / `OpenAiSdkGateway`) already landed in commit `40fca7b` (#287); this plan consumes it and must not re-introduce or re-refactor it.

Do not stage or commit anything under `docs/superpowers/`. `CLAUDE.md` says these files are local-only and `.gitignore` already ignores them.

The current working tree may contain unrelated user changes. Do not revert or rewrite them. Before touching files that already appear modified, inspect them and work with the current contents.

## Source Provider Decision

Use OpenAI Responses web search for the production `SourceSearchService`, but only through the existing `AiGateway.createResponse()`. This avoids adding another paid provider/key for MVP and keeps the feature under the existing `OPENAI_KEY`. The gateway already exposes `createResponse({ model, input, tools })` returning `{ outputText, usage, raw }`; the source search service passes the web search tool via `tools` and parses citations/annotations from `raw`.

Before implementing the production adapter, run the required documentation lookup (per `CLAUDE.md`/`AGENTS.md`):

```powershell
npx ctx7@latest library "OpenAI Node SDK" "OpenAI Responses API web search TypeScript sources citations"
```

After the `library` command prints candidates, choose the best official
OpenAI Node SDK match and run `docs` with that exact Context7 library id:

```powershell
npx ctx7@latest docs /openai/openai-node "OpenAI Responses API web search TypeScript sources citations"
```

If the `library` output shows a more exact official OpenAI SDK id or
version-specific id, use that exact id instead of `/openai/openai-node`.

If Context7 quota fails, follow the repo instruction and tell the user to run `npx ctx7@latest login` or set `CONTEXT7_API_KEY`. Do not silently guess the production adapter shape. Tests can use fake source search and should not depend on network.

## File Structure

Create:

- `src/application/fact-checking/FactCheckConfig.ts`
  - Runtime config and DI identifier for schedules, caps, and feature flag.
- `src/application/fact-checking/FactCheckPromptContext.ts`
  - Prompt-context interfaces shared by `PromptDirector` and the reasoning service.
- `src/application/fact-checking/FactCheckReasoningService.ts`
  - Interface for claim extraction and verification.
- `src/application/fact-checking/SourceSearchService.ts`
  - Interface and normalized source result types.
- `src/application/fact-checking/FactCheckPipeline.ts`
  - Interface for running one chat batch.
- `src/application/fact-checking/DefaultFactCheckPipeline.ts`
  - Orchestrates message loading, extraction, source search, verification, persistence, notification, and watermark updates.
- `src/application/fact-checking/FactCheckNotifier.ts`
  - Interface for sending immediate and digest notifications.
- `src/application/fact-checking/DefaultFactCheckNotifier.ts`
  - Telegram notification service using `ChatMessenger`.
- `src/application/fact-checking/FactCheckScheduler.ts`
  - Interface for scheduler start/stop/run methods.
- `src/application/fact-checking/DefaultFactCheckScheduler.ts`
  - node-cron scheduler for hourly checks and reports.
- `src/application/fact-checking/FactCheckStatsService.ts`
  - Interface and DI id for daily/weekly/monthly stats.
- `src/application/fact-checking/DefaultFactCheckStatsService.ts`
  - Implementation that maps `FactCheckStatsRow[]` into a `FactCheckStatsReportInput`.
- `src/application/fact-checking/FactCheckSourcePolicy.ts`
  - Confirmation rules for source quality and high-stakes categories.
- `src/application/fact-checking/FactCheckFormatter.ts`
  - Telegram HTML escaping, truncation, digest, and stats formatting.
- `src/application/fact-checking/FactCheckMessageLinks.ts`
  - Telegram message URL builder and fallback labels.
- `src/application/fact-checking/FactCheckDeduplication.ts`
  - Normalized claim keys.
- `src/domain/fact-checking/FactCheckTypes.ts`
  - Domain type aliases and interfaces.
- `src/domain/fact-checking/FactCheckSchemas.ts`
  - Zod schemas and OpenAI JSON schemas for extraction and verification.
- `src/domain/entities/FactCheckRunEntity.ts`
- `src/domain/entities/FactCheckFindingEntity.ts`
- `src/domain/entities/FactCheckSourceEntity.ts`
- `src/domain/entities/FactCheckWindowEntity.ts`
- `src/domain/repositories/FactCheckRepository.ts`
  - Three segregated interfaces (`FactCheckRunRepository`, `FactCheckFindingRepository`, `FactCheckStatsRepository`) + their DI ids + shared input/query types. One SQLite class implements all three; each client injects only the interface it needs (ISP).
- `src/domain/repositories/FactCheckWindowRepository.ts`
  - Watermark cursor (chat → last_checked_message_id); distinct from the message-window reader below.
- `src/domain/repositories/FactCheckMessageWindowRepository.ts`
  - Fact-check-owned read port for ready-message batches/context, so the general `MessageService`/`MessageRepository` stay free of fact-check concerns.
- `src/application/fact-checking/DefaultFactCheckReasoningService.ts`
- `src/application/fact-checking/DefaultFactCheckSourceSearchService.ts`
- `src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository.ts`
- `src/infrastructure/persistence/sqlite/SQLiteFactCheckWindowRepository.ts`
- `src/infrastructure/persistence/sqlite/SQLiteFactCheckMessageWindowRepository.ts`
- `prompts/fact_check_claim_extraction_system_prompt.md`
- `prompts/fact_check_verification_system_prompt.md`
- `migrations/022_fact_checking.up.sql`
- `migrations/022_fact_checking.down.sql`
- `test/factCheckSchemas.test.ts`
- `test/FactCheckSourcePolicy.test.ts`
- `test/FactCheckFormatter.test.ts`
- `test/FactCheckMessageLinks.test.ts`
- `test/FactCheckDeduplication.test.ts`
- `test/factCheckMigration022.test.ts`
- `test/SQLiteFactCheckRepository.test.ts`
- `test/SQLiteFactCheckWindowRepository.test.ts`
- `test/FactCheckMessageWindowRepository.test.ts`
- `test/DefaultFactCheckReasoningService.test.ts`
- `test/DefaultFactCheckSourceSearchService.test.ts`
- `test/DefaultFactCheckPipeline.test.ts`
- `test/DefaultFactCheckNotifier.test.ts`
- `test/FactCheckStatsService.test.ts`
- `test/FactCheckScheduler.test.ts`
- `test/container.fact-checking.test.ts`

Modify:

- `src/application/interfaces/env/EnvService.ts`
  - Add fact-check env fields, model slots, prompt files, and `getFactCheckConfig()`.
- `src/infrastructure/config/envSchema.ts`
  - Parse fact-check env vars with conservative defaults.
- `src/infrastructure/config/DefaultEnvService.ts`
  - Return fact-check models, prompt paths, and config.
- `src/infrastructure/config/TestEnvService.ts`
  - Provide test defaults.
- `.env.example`
  - Document fact-check env values.
- `src/domain/entities/ChatEntity.ts`
  - Add optional `username`.
- `src/domain/messages/StoredMessage.ts`
  - Add optional `chatUsername`.
- `src/application/use-cases/messages/MessageFactory.ts`
  - Capture chat username from Telegram context.
- `src/application/use-cases/messages/RepositoryMessageService.ts`
  - Persist chat username.
- `src/domain/repositories/ChatRepository.ts`
  - Continue same API, but entity includes username.
- `src/infrastructure/persistence/sqlite/SQLiteChatRepository.ts`
  - Persist/read `username`.
- `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts`
  - Export the shared `SELECT_MESSAGE_COLUMNS` constant and `rowToMessage` mapper so the new fact-check message-window repo can reuse them (DRY). No new methods added to `MessageRepository`/`MessageService` — fact-check reads live in their own port.
- `src/application/prompts/PromptBuilder.ts`
  - Add fact-check prompt builder steps.
- `src/application/prompts/PromptDirector.ts`
  - Add fact-check prompt creation methods.
- `src/container/repositories.ts`
  - Bind new repositories.
- `src/container/application.ts`
  - Bind fact-check config, services, scheduler, and external adapters.
- `src/view/telegram/MainService.ts`
  - Start/stop fact-check scheduler.
- `src/application/interfaces/scheduler/ManualJobRunner.ts`
  - Add manual job names for fact checking.
- `src/application/use-cases/scheduler/DefaultManualJobRunner.ts`
  - Run fact-check jobs manually.
- `src/manual-job.ts`
  - Accept fact-check job names.
- Existing tests touched by changed interfaces:
  - `test/EnvService.test.ts`
  - `test/RepositoryMessageService.test.ts`
  - `test/sqliteRepositories.test.ts`
  - `test/MessageFactory.test.ts`
  - `test/PromptBuilder.test.ts`
  - `test/PromptDirector.test.ts`
  - `test/ManualJobRunner.test.ts`
  - `test/MainService.test.ts`

## Task 1: Add Fact-Check Config And Env Contracts

**Files:**

- Create: `src/application/fact-checking/FactCheckConfig.ts`
- Modify: `src/application/interfaces/env/EnvService.ts`
- Modify: `src/infrastructure/config/envSchema.ts`
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`
- Modify: `.env.example`
- Test: `test/EnvService.test.ts`

- [ ] **Step 1: Write failing config tests**

Add tests in `test/EnvService.test.ts` that assert:

```ts
const env = new TestEnvService();
expect(env.getFactCheckConfig()).toEqual(
  expect.objectContaining({
    enabled: false,
    hourlyCron: '0 0 * * * *',
    timezone: 'Europe/Warsaw',
    maxMessagesPerBatch: 200,
    maxClaimsPerBatch: 40,
    maxHistoryContextMessages: 100,
    maxSourceSearchesPerBatch: 20,
    maxSourcesPerFinding: 5,
    maxDisplayedSourcesPerFinding: 3,
    maxFindingsPerDigestMessage: 10,
    verificationConfidenceThreshold: 0.75,
  })
);
expect(env.getModels().factCheckExtraction.default).toBe('gpt-5.4-mini');
expect(env.getModels().factCheckVerification.escalation).toBe('gpt-5.5');
```

**Also update the existing strict assertion** in the `getModels returns correct models` test (it uses `toEqual({ ... })`, so adding slots without updating it will fail). Extend that object with the new slots:

```ts
expect(env.getModels()).toEqual({
  triggerGate: { default: 'gpt-5.4-mini' },
  behaviorDecision: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
  summarization: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
  stateEvolution: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
  errorRepair: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
  factCheckExtraction: { default: 'gpt-5.4-mini' },
  factCheckVerification: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
  sourceSearch: { default: 'gpt-5.4-mini' },
});
```

(The `getPromptFiles` strict `toEqual` test is updated later in Task 6, when the two fact-check prompt files are added.)

- [ ] **Step 2: Run the failing test**

Run:

```powershell
pnpm test -- test/EnvService.test.ts
```

Expected: fail because `getFactCheckConfig()` and model slots do not exist.

- [ ] **Step 3: Create config type and DI id**

Create `src/application/fact-checking/FactCheckConfig.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

export interface FactCheckConfig {
  enabled: boolean;
  hourlyCron: string;
  dailyStatsCron: string;
  weeklyStatsCron: string;
  monthlyStatsCron: string;
  timezone: string;
  maxMessagesPerBatch: number;
  maxClaimsPerBatch: number;
  maxHistoryContextMessages: number;
  maxSourceSearchesPerBatch: number;
  maxSourcesPerFinding: number;
  maxDisplayedSourcesPerFinding: number;
  maxFindingsPerDigestMessage: number;
  // Verification findings below this confidence trigger one escalation retry.
  // Pattern-aligned with BehaviorPipelineConfig.minDecisionConfidence.
  verificationConfidenceThreshold: number;
}

export const FACT_CHECK_CONFIG_ID = Symbol.for(
  'FactCheckConfig'
) as ServiceIdentifier<FactCheckConfig>;
```

- [ ] **Step 4: Extend `Env` and model slots**

In `src/application/interfaces/env/EnvService.ts`:

- Import `FactCheckConfig`.
- Add env fields:

```ts
FACT_CHECK_ENABLED: boolean;
FACT_CHECK_HOURLY_CRON: string;
FACT_CHECK_DAILY_STATS_CRON: string;
FACT_CHECK_WEEKLY_STATS_CRON: string;
FACT_CHECK_MONTHLY_STATS_CRON: string;
FACT_CHECK_TIMEZONE: string;
FACT_CHECK_MAX_MESSAGES_PER_BATCH: number;
FACT_CHECK_MAX_CLAIMS_PER_BATCH: number;
FACT_CHECK_MAX_HISTORY_CONTEXT_MESSAGES: number;
FACT_CHECK_MAX_SOURCE_SEARCHES_PER_BATCH: number;
FACT_CHECK_MAX_SOURCES_PER_FINDING: number;
FACT_CHECK_MAX_DISPLAYED_SOURCES_PER_FINDING: number;
FACT_CHECK_MAX_FINDINGS_PER_DIGEST_MESSAGE: number;
FACT_CHECK_VERIFICATION_CONFIDENCE_THRESHOLD: number;
```

- Add model slots to the existing `AiModelSlots` interface (`SingleModelSlot`/`EscalatingModelSlot` already exist there):

```ts
factCheckExtraction: SingleModelSlot;
factCheckVerification: EscalatingModelSlot;
sourceSearch: SingleModelSlot;
```

- Add the method to the `EnvService` interface:

```ts
getFactCheckConfig(): FactCheckConfig;
```

- [ ] **Step 5: Extend `envSchema`**

In `src/infrastructure/config/envSchema.ts`, add defaults:

```ts
FACT_CHECK_ENABLED: booleanEnv.default(false),
FACT_CHECK_HOURLY_CRON: z.string().min(1).default('0 0 * * * *'),
FACT_CHECK_DAILY_STATS_CRON: z.string().min(1).default('0 0 9 * * *'),
FACT_CHECK_WEEKLY_STATS_CRON: z.string().min(1).default('0 0 9 * * 1'),
FACT_CHECK_MONTHLY_STATS_CRON: z.string().min(1).default('0 0 9 1 * *'),
FACT_CHECK_TIMEZONE: z.string().min(1).default('Europe/Warsaw'),
FACT_CHECK_MAX_MESSAGES_PER_BATCH: z.coerce.number().int().positive().default(200),
FACT_CHECK_MAX_CLAIMS_PER_BATCH: z.coerce.number().int().positive().default(40),
FACT_CHECK_MAX_HISTORY_CONTEXT_MESSAGES: z.coerce.number().int().positive().default(100),
FACT_CHECK_MAX_SOURCE_SEARCHES_PER_BATCH: z.coerce.number().int().positive().default(20),
FACT_CHECK_MAX_SOURCES_PER_FINDING: z.coerce.number().int().positive().default(5),
FACT_CHECK_MAX_DISPLAYED_SOURCES_PER_FINDING: z.coerce.number().int().positive().default(3),
FACT_CHECK_MAX_FINDINGS_PER_DIGEST_MESSAGE: z.coerce.number().int().positive().default(10),
FACT_CHECK_VERIFICATION_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
```

Keep formatting aligned with existing schema style.

- [ ] **Step 6: Implement config in env services**

In `DefaultEnvService.getModels()` and `TestEnvService.getModels()`, add (note: `AiModelId` is the model type, already imported in both files — there is no `ChatModel` type):

```ts
factCheckExtraction: { default: 'gpt-5.4-mini' as AiModelId },
factCheckVerification: {
  default: 'gpt-5.4-mini' as AiModelId,
  escalation: 'gpt-5.5' as AiModelId,
},
sourceSearch: { default: 'gpt-5.4-mini' as AiModelId },
```

In both env services, add:

```ts
getFactCheckConfig(): FactCheckConfig {
  return {
    enabled: this.env.FACT_CHECK_ENABLED,
    hourlyCron: this.env.FACT_CHECK_HOURLY_CRON,
    dailyStatsCron: this.env.FACT_CHECK_DAILY_STATS_CRON,
    weeklyStatsCron: this.env.FACT_CHECK_WEEKLY_STATS_CRON,
    monthlyStatsCron: this.env.FACT_CHECK_MONTHLY_STATS_CRON,
    timezone: this.env.FACT_CHECK_TIMEZONE,
    maxMessagesPerBatch: this.env.FACT_CHECK_MAX_MESSAGES_PER_BATCH,
    maxClaimsPerBatch: this.env.FACT_CHECK_MAX_CLAIMS_PER_BATCH,
    maxHistoryContextMessages: this.env.FACT_CHECK_MAX_HISTORY_CONTEXT_MESSAGES,
    maxSourceSearchesPerBatch: this.env.FACT_CHECK_MAX_SOURCE_SEARCHES_PER_BATCH,
    maxSourcesPerFinding: this.env.FACT_CHECK_MAX_SOURCES_PER_FINDING,
    maxDisplayedSourcesPerFinding:
      this.env.FACT_CHECK_MAX_DISPLAYED_SOURCES_PER_FINDING,
    maxFindingsPerDigestMessage:
      this.env.FACT_CHECK_MAX_FINDINGS_PER_DIGEST_MESSAGE,
    verificationConfidenceThreshold:
      this.env.FACT_CHECK_VERIFICATION_CONFIDENCE_THRESHOLD,
  };
}
```

- [ ] **Step 7: Update `.env.example`**

Add the new keys with conservative defaults. Keep `FACT_CHECK_ENABLED=false`.

- [ ] **Step 8: Run config tests**

Run:

```powershell
pnpm test -- test/EnvService.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```powershell
git add src/application/fact-checking/FactCheckConfig.ts src/application/interfaces/env/EnvService.ts src/infrastructure/config/envSchema.ts src/infrastructure/config/DefaultEnvService.ts src/infrastructure/config/TestEnvService.ts .env.example test/EnvService.test.ts
git commit -m "feat(fact-check): add runtime config"
```

Do not add `docs/superpowers/...`.

## Task 2: Add Fact-Check Domain Types And Structured Output Schemas

**Files:**

- Create: `src/domain/fact-checking/FactCheckTypes.ts`
- Create: `src/domain/fact-checking/FactCheckSchemas.ts`
- Test: `test/factCheckSchemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Create `test/factCheckSchemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  claimExtractionResultJsonSchema,
  claimExtractionResultSchema,
  factVerificationResultJsonSchema,
  factVerificationResultSchema,
} from '../src/domain/fact-checking/FactCheckSchemas';

describe('fact-check structured output schemas', () => {
  it('parses extraction results with required fields', () => {
    const parsed = claimExtractionResultSchema.parse({
      claims: [
        {
          messageId: 10,
          claimText: 'The euro was introduced in 2000.',
          category: 'external_fact',
          needsExternalSources: true,
          riskLevel: 'low',
          whyCheckable: 'Specific historical date claim.',
          contextMessageIds: [],
        },
      ],
    });
    expect(parsed.claims).toHaveLength(1);
  });

  it('parses verification results and allows no_error', () => {
    const parsed = factVerificationResultSchema.parse({
      findings: [
        {
          messageId: 10,
          claimText: 'The euro was introduced in 2000.',
          status: 'confirmed',
          confidence: 0.91,
          correctedFact: 'Euro banknotes and coins entered circulation in 2002.',
          explanation: 'The claim confuses accounting introduction with cash circulation.',
          sourceRequirementsMet: true,
          sourceIndexes: [0],
          shouldNotifyImmediately: false,
        },
      ],
    });
    expect(parsed.findings[0]?.status).toBe('confirmed');
  });

  it('emits strict OpenAI-compatible JSON schemas', () => {
    expect(claimExtractionResultJsonSchema.strict).toBe(true);
    expect(factVerificationResultJsonSchema.strict).toBe(true);
    expect(JSON.stringify(claimExtractionResultJsonSchema)).not.toContain('"maximum"');

    // OpenAI strict mode rejects any object that does not list ALL of its
    // properties in `required` and set `additionalProperties: false`. The
    // weak `not.toContain('"maximum"')` check above does not catch this, so a
    // bad schema would only fail at runtime with an OpenAI 400. Walk the
    // emitted schema and assert strict-compatibility everywhere instead.
    const assertStrictObjects = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(assertStrictObjects);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.type === 'object' && obj.properties != null) {
        const props = Object.keys(obj.properties as Record<string, unknown>);
        const required = (obj.required as string[] | undefined) ?? [];
        expect([...required].sort()).toEqual([...props].sort());
        expect(obj.additionalProperties).toBe(false);
      }
      Object.values(obj).forEach(assertStrictObjects);
    };

    assertStrictObjects(claimExtractionResultJsonSchema.schema);
    assertStrictObjects(factVerificationResultJsonSchema.schema);
  });
});

> **Note:** the existing behavior decision schemas already round-trip through
> OpenAI strict mode in production via the same `toOpenAiJsonSchema`, so the
> emitted schema already satisfies these assertions. If a new schema fails this
> test, mirror the behavior schemas' construction rather than relaxing the test.
```

- [ ] **Step 2: Run failing schema test**

Run:

```powershell
pnpm test -- test/factCheckSchemas.test.ts
```

Expected: fail because files do not exist.

- [ ] **Step 3: Add domain types**

Create `src/domain/fact-checking/FactCheckTypes.ts`:

```ts
export type FactCheckCategory =
  | 'external_fact'
  | 'chat_history'
  | 'medical'
  | 'legal'
  | 'financial'
  | 'safety'
  | 'mixed';

export type FactCheckSeverity = 'low' | 'medium' | 'high';
export type FactCheckStatus = 'confirmed' | 'uncertain';
export type FactCheckVerificationStatus = FactCheckStatus | 'no_error';
export type FactCheckSourcePolicy =
  | 'chat_history_only'
  | 'reliable_or_media_allowed'
  | 'primary_required';
export type FactCheckSourceReliability =
  | 'primary'
  | 'authoritative'
  | 'media'
  | 'weak';

export interface ExtractedClaim {
  messageId: number;
  claimText: string;
  category: FactCheckCategory;
  needsExternalSources: boolean;
  riskLevel: FactCheckSeverity;
  whyCheckable: string;
  contextMessageIds: number[];
}

export interface VerificationFinding {
  messageId: number;
  claimText: string;
  status: FactCheckVerificationStatus;
  confidence: number;
  correctedFact: string;
  explanation: string;
  sourceRequirementsMet: boolean;
  sourceIndexes: number[];
  shouldNotifyImmediately: boolean;
}
```

- [ ] **Step 4: Add Zod schemas**

Create `src/domain/fact-checking/FactCheckSchemas.ts`:

```ts
import { z } from 'zod';

import { toOpenAiJsonSchema } from '@/domain/behavior/schemas/jsonSchema';

export const factCheckCategorySchema = z.enum([
  'external_fact',
  'chat_history',
  'medical',
  'legal',
  'financial',
  'safety',
  'mixed',
]);

export const factCheckSeveritySchema = z.enum(['low', 'medium', 'high']);
export const factCheckStatusSchema = z.enum(['confirmed', 'uncertain']);
export const factCheckVerificationStatusSchema = z.enum([
  'confirmed',
  'uncertain',
  'no_error',
]);
export const factCheckSourceReliabilitySchema = z.enum([
  'primary',
  'authoritative',
  'media',
  'weak',
]);

const confidenceSchema = z.number().min(0).max(1);
const messageIdSchema = z.number().int().positive();

export const extractedClaimSchema = z.object({
  messageId: messageIdSchema,
  claimText: z.string(),
  category: factCheckCategorySchema,
  needsExternalSources: z.boolean(),
  riskLevel: factCheckSeveritySchema,
  whyCheckable: z.string(),
  contextMessageIds: z.array(messageIdSchema),
});

export const claimExtractionResultSchema = z.object({
  claims: z.array(extractedClaimSchema),
});

export const verificationFindingSchema = z.object({
  messageId: messageIdSchema,
  claimText: z.string(),
  status: factCheckVerificationStatusSchema,
  confidence: confidenceSchema,
  correctedFact: z.string(),
  explanation: z.string(),
  sourceRequirementsMet: z.boolean(),
  sourceIndexes: z.array(z.number().int().nonnegative()),
  shouldNotifyImmediately: z.boolean(),
});

export const factVerificationResultSchema = z.object({
  findings: z.array(verificationFindingSchema),
});

export const claimExtractionResultJsonSchema = toOpenAiJsonSchema(
  claimExtractionResultSchema,
  'FactCheckClaimExtraction'
);

export const factVerificationResultJsonSchema = toOpenAiJsonSchema(
  factVerificationResultSchema,
  'FactCheckVerification'
);

export type ClaimExtractionResult = z.infer<
  typeof claimExtractionResultSchema
>;
export type FactVerificationResult = z.infer<
  typeof factVerificationResultSchema
>;
```

Keep optional values out of structured-output schemas. Use nullable required
fields if more fields are added later.

- [ ] **Step 5: Run schema tests**

Run:

```powershell
pnpm test -- test/factCheckSchemas.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/fact-checking/FactCheckTypes.ts src/domain/fact-checking/FactCheckSchemas.ts test/factCheckSchemas.test.ts
git commit -m "feat(fact-check): add structured output schemas"
```

## Task 3: Add Chat Username And Fact-Check Message Window Port

**Isolation note:** the fact-check message reads do **not** go on the shared `MessageService`/`MessageRepository`. They live in a fact-check-owned port, `FactCheckMessageWindowRepository` (distinct from the watermark `FactCheckWindowRepository` in Task 4), implemented by a thin SQLite adapter that reuses the exported message row mapper. This keeps the general message contract free of feature-specific methods.

**Dependency note (Task 3 ↔ Task 4):** this task cannot go fully green on its own — the SQLite changes and the window-port test both require the `chats.username` column and (for the `processing_status` filter) a migrated DB, which Task 4 creates. Implement Task 3 and Task 4 on the same branch and run the combined test set **after** Task 4's migration exists. Each step below still has its own failing-test-first cycle; only the final test run is deferred to Task 4.

**`chatUsername` carrier note:** `chatUsername` is added to `StoredMessage` and captured in `MessageFactory` for one purpose only — to carry the value into the `chats.username` column via `RepositoryMessageService` → `ChatEntity` upsert. `SELECT_MESSAGE_COLUMNS`/`rowToMessage` are **not** extended, so `ChatMessage.chatUsername` is never read back from the messages join. The pipeline (Task 9) resolves the username for message links from `chatRepo.findById(chatId)`, not from the message row. Do not wire a read path for `chatUsername` on messages — it would be dead code.

**Files:**

- Modify: `src/domain/entities/ChatEntity.ts`
- Modify: `src/domain/messages/StoredMessage.ts`
- Modify: `src/application/use-cases/messages/MessageFactory.ts`
- Modify: `src/application/use-cases/messages/RepositoryMessageService.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteChatRepository.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts` (export `SELECT_MESSAGE_COLUMNS` + `rowToMessage` only)
- Create: `src/domain/repositories/FactCheckMessageWindowRepository.ts`
- Create: `src/infrastructure/persistence/sqlite/SQLiteFactCheckMessageWindowRepository.ts`
- Modify: `src/container/repositories.ts` (bind the new port)
- Test: `test/MessageFactory.test.ts`
- Test: `test/RepositoryMessageService.test.ts`
- Test: `test/sqliteRepositories.test.ts`
- Test: `test/FactCheckMessageWindowRepository.test.ts`

- [ ] **Step 1: Write failing tests for chat username capture**

In `test/MessageFactory.test.ts`, add a test that builds a Telegram context with `chat.username = 'publicchat'` and expects:

```ts
expect(message.chatUsername).toBe('publicchat');
```

In `test/RepositoryMessageService.test.ts`, update the chat upsert assertion so `ChatEntity` carries username.

- [ ] **Step 2: Write failing tests for the fact-check message window port**

Create `test/FactCheckMessageWindowRepository.test.ts` with a temp DB and migrations, exercising `SQLiteFactCheckMessageWindowRepository` (not the general message repo). Insert messages with ids 1, 2, 3, then assert:

```ts
const batch = await windowRepo.findReadyByChatIdAfterId(1, 1, 10);
expect(batch.map((m) => m.id)).toEqual([2, 3]);

const context = await windowRepo.findReadyContextBeforeId(1, 3, 2);
expect(context.map((m) => m.id)).toEqual([1, 2]);
```

Also insert a `processing_status = 'pending'` row and assert it is excluded
from `findReadyByChatIdAfterId` results.

**Stop-at-hole watermark case (the leapfrog fix).** This is the key correctness
test. In a fresh chat insert: id=1 `ready`, id=2 `pending` (a voice message still
transcribing), id=3 `ready`. Assert the batch stops before the pending hole so
the cursor cannot leapfrog id=2:

```ts
// Only the contiguous ready prefix before the first pending id is returned.
const firstPass = await windowRepo.findReadyByChatIdAfterId(1, 0, 10);
expect(firstPass.map((m) => m.id)).toEqual([1]); // NOT [1, 3]

// After id=2 transcribes to 'ready', the rest becomes available.
await db.run(
  "UPDATE messages SET processing_status = 'ready' WHERE id = ?",
  2
);
const secondPass = await windowRepo.findReadyByChatIdAfterId(1, 1, 10);
expect(secondPass.map((m) => m.id)).toEqual([2, 3]);
```

Also assert that a **`failed`** message is NOT treated as a hole: insert id=1
`ready`, id=2 `failed`, id=3 `ready`; `findReadyByChatIdAfterId(1, 0, 10)` must
return `[1, 3]` (terminal `failed` is passable; only transient `pending` blocks
the cursor, otherwise a permanently-failed voice would freeze the chat forever).

- [ ] **Step 3: Run failing tests**

Run:

```powershell
pnpm test -- test/MessageFactory.test.ts test/RepositoryMessageService.test.ts test/FactCheckMessageWindowRepository.test.ts
```

Expected: fail because fields and the new port do not exist.

- [ ] **Step 4: Add `username` to `ChatEntity`**

Modify `src/domain/entities/ChatEntity.ts`:

```ts
export class ChatEntity {
  private _title: string | null;
  private _username: string | null;

  constructor(
    public readonly chatId: number,
    title?: string | null,
    username?: string | null
  ) {
    if (!Number.isInteger(chatId)) {
      throw new Error('Invalid chat id');
    }
    this._title = title ?? null;
    this._username = username ?? null;
  }

  get title(): string | null {
    return this._title;
  }

  get username(): string | null {
    return this._username;
  }

  rename(title?: string | null): void {
    this._title = title ?? null;
  }

  setUsername(username?: string | null): void {
    this._username = username ?? null;
  }
}
```

- [ ] **Step 5: Capture chat username**

Add `chatUsername?: string;` to `StoredMessage`.

In `MessageFactory`, set `chatUsername` when `ctx.chat` has a `username` string. Do not use `any`; use type guards or property checks.

In `RepositoryMessageService.addMessage`, construct:

```ts
const chat = new ChatEntity(
  message.chatId,
  message.chatTitle ?? null,
  message.chatUsername ?? null
);
```

- [ ] **Step 6: Persist chat username**

In `SQLiteChatRepository`, update insert/select:

```ts
'INSERT INTO chats (chat_id, title, username) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title, username=excluded.username'
```

and read `username` into `new ChatEntity(row.chat_id, row.title, row.username)`.

The migration for the column is in Task 4. For tests that run all migrations, this will work after Task 4. Until then, keep this task on the same branch and run full tests after Task 4.

- [ ] **Step 7: Add the isolated fact-check message window port**

First, in `SQLiteMessageRepository.ts`, change the module-local `SELECT_MESSAGE_COLUMNS` constant and the `rowToMessage` function (and the `MessageRow` type) to `export` so they can be reused without duplication. This is the only change to the general message file — no new methods on `MessageRepository`/`MessageService`.

Create the port `src/domain/repositories/FactCheckMessageWindowRepository.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

import type { ChatMessage } from '@/domain/messages/ChatMessage';

// Read port for fact-checking only. Distinct from FactCheckWindowRepository,
// which stores the per-chat watermark cursor.
export interface FactCheckMessageWindowRepository {
  findReadyByChatIdAfterId(
    chatId: number,
    afterId: number,
    limit: number
  ): Promise<ChatMessage[]>;
  findReadyContextBeforeId(
    chatId: number,
    beforeId: number,
    limit: number
  ): Promise<ChatMessage[]>;
}

export const FACT_CHECK_MESSAGE_WINDOW_REPOSITORY_ID = Symbol.for(
  'FactCheckMessageWindowRepository'
) as ServiceIdentifier<FactCheckMessageWindowRepository>;
```

Implement `src/infrastructure/persistence/sqlite/SQLiteFactCheckMessageWindowRepository.ts`, injecting `DB_PROVIDER_ID` and reusing the exported helpers:

```ts
import { inject, injectable } from 'inversify';

import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { FactCheckMessageWindowRepository } from '@/domain/repositories/FactCheckMessageWindowRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import {
  SELECT_MESSAGE_COLUMNS,
  rowToMessage,
  type MessageRow,
} from '@/infrastructure/persistence/sqlite/SQLiteMessageRepository';

@injectable()
export class SQLiteFactCheckMessageWindowRepository
  implements FactCheckMessageWindowRepository
{
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async findReadyByChatIdAfterId(
    chatId: number,
    afterId: number,
    limit: number
  ): Promise<ChatMessage[]> {
    const db = await this.dbProvider.get();
    // Stop-at-hole: never return a ready message at or beyond the first still
    // `pending` message id (a voice message mid-transcription). Its DB id is
    // already assigned, so if we processed past it the watermark would advance
    // beyond it and it would never be fact-checked once it flips to `ready`
    // (the leapfrog bug). `failed` is terminal and intentionally NOT a hole, so
    // a permanently-failed voice message does not freeze the chat. COALESCE to
    // a max-bigint sentinel when there is no pending hole.
    const rows = await db.all<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.chat_id = ? AND m.id > ? AND m.is_active = 1 AND m.processing_status = 'ready' AND m.id < COALESCE((SELECT MIN(id) FROM messages WHERE chat_id = ? AND is_active = 1 AND processing_status = 'pending' AND id > ?), 9223372036854775807) ORDER BY m.id ASC LIMIT ?`,
      chatId,
      afterId,
      chatId,
      afterId,
      limit
    );
    return (rows ?? []).map(rowToMessage);
  }

  async findReadyContextBeforeId(
    chatId: number,
    beforeId: number,
    limit: number
  ): Promise<ChatMessage[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.chat_id = ? AND m.id < ? AND m.is_active = 1 AND m.processing_status = 'ready' ORDER BY m.id DESC LIMIT ?`,
      chatId,
      beforeId,
      limit
    );
    return (rows ?? []).map(rowToMessage).reverse();
  }
}
```

Bind it in `src/container/repositories.ts`:

```ts
container
  .bind<FactCheckMessageWindowRepository>(
    FACT_CHECK_MESSAGE_WINDOW_REPOSITORY_ID
  )
  .to(SQLiteFactCheckMessageWindowRepository)
  .inSingletonScope();
```

- [ ] **Step 8: Run targeted tests after Task 4 migration exists**

Run after Task 4:

```powershell
pnpm test -- test/MessageFactory.test.ts test/RepositoryMessageService.test.ts test/sqliteRepositories.test.ts test/FactCheckMessageWindowRepository.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit with Task 4**

Commit this together with migration changes if tests require the `username` column. Use:

```powershell
git add src/domain/entities/ChatEntity.ts src/domain/messages/StoredMessage.ts src/application/use-cases/messages/MessageFactory.ts src/application/use-cases/messages/RepositoryMessageService.ts src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts src/infrastructure/persistence/sqlite/SQLiteChatRepository.ts src/domain/repositories/FactCheckMessageWindowRepository.ts src/infrastructure/persistence/sqlite/SQLiteFactCheckMessageWindowRepository.ts src/container/repositories.ts test/MessageFactory.test.ts test/RepositoryMessageService.test.ts test/sqliteRepositories.test.ts test/FactCheckMessageWindowRepository.test.ts
git commit -m "feat(fact-check): add chat username and isolated message window port"
```

## Task 4: Add SQLite Migration And Fact-Check Repositories

**Files:**

- Create: `migrations/022_fact_checking.up.sql`
- Create: `migrations/022_fact_checking.down.sql`
- Create: `src/domain/entities/FactCheckRunEntity.ts`
- Create: `src/domain/entities/FactCheckFindingEntity.ts`
- Create: `src/domain/entities/FactCheckSourceEntity.ts`
- Create: `src/domain/entities/FactCheckWindowEntity.ts`
- Create: `src/domain/repositories/FactCheckRepository.ts`
- Create: `src/domain/repositories/FactCheckWindowRepository.ts`
- Create: `src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository.ts`
- Create: `src/infrastructure/persistence/sqlite/SQLiteFactCheckWindowRepository.ts`
- Modify: `src/container/repositories.ts`
- Test: `test/factCheckMigration022.test.ts`
- Test: `test/SQLiteFactCheckRepository.test.ts`
- Test: `test/SQLiteFactCheckWindowRepository.test.ts`

- [ ] **Step 1: Write failing migration test**

Create `test/factCheckMigration022.test.ts` following the exact pattern in `test/voiceMigration019.test.ts` (set `process.env.DATABASE_URL` to a temp file, `await migrateUp()` from `../src/migrate`, then open the db with `sqlite`/`sqlite3` and query). There is no `provider.listTables()` helper — query `sqlite_master` directly:

```ts
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 022 fact checking', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('creates fact-check tables and adds chats.username', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'factcheck-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const tables = await db.all<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    );
    const chatColumns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(chats)'
    );
    await db.close();

    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'fact_check_windows',
        'fact_check_runs',
        'fact_check_findings',
        'fact_check_sources',
      ])
    );
    expect(chatColumns.map((c) => c.name)).toContain('username');
  });
});
```

- [ ] **Step 2: Write failing repository tests**

In `test/SQLiteFactCheckWindowRepository.test.ts`, test:

- `get(chatId)` returns null when missing.
- `upsert` stores and updates `lastCheckedMessageId`.

In `test/SQLiteFactCheckRepository.test.ts`, test:

- create run.
- complete run.
- fail run.
- insert finding with sources.
- duplicate `messageId + normalizedClaimKey` does not insert twice.
- list digest candidates excludes already `digest_notified_at` rows.
- stats count confirmed and uncertain separately.

- [ ] **Step 3: Run failing tests**

Run:

```powershell
pnpm test -- test/factCheckMigration022.test.ts test/SQLiteFactCheckRepository.test.ts test/SQLiteFactCheckWindowRepository.test.ts
```

Expected: fail because migration and repos do not exist.

- [ ] **Step 4: Add migration**

Create `migrations/022_fact_checking.up.sql`:

```sql
BEGIN TRANSACTION;

ALTER TABLE chats ADD COLUMN username TEXT;

CREATE TABLE fact_check_windows (
  chat_id INTEGER PRIMARY KEY,
  last_checked_message_id INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE fact_check_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  message_from_id INTEGER,
  message_to_id INTEGER,
  extractor_model TEXT,
  verifier_model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  error_message TEXT,
  request_json TEXT,
  response_json TEXT
);

CREATE TABLE fact_check_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  telegram_message_id INTEGER,
  author_user_id INTEGER,
  author_display_name TEXT NOT NULL,
  normalized_claim_key TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  original_quote TEXT NOT NULL,
  corrected_fact TEXT NOT NULL,
  explanation TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  source_policy TEXT NOT NULL,
  source_requirements_met INTEGER NOT NULL,
  message_url TEXT,
  immediate_notified_at TEXT,
  digest_notified_at TEXT,
  notification_error TEXT,
  created_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES fact_check_runs(id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE fact_check_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT,
  snippet TEXT NOT NULL,
  reliability TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  FOREIGN KEY (finding_id) REFERENCES fact_check_findings(id)
);

CREATE UNIQUE INDEX idx_fact_check_findings_dedup
  ON fact_check_findings(message_id, normalized_claim_key);

CREATE INDEX idx_fact_check_findings_chat_checked
  ON fact_check_findings(chat_id, checked_at);

CREATE INDEX idx_fact_check_findings_author_checked
  ON fact_check_findings(author_user_id, checked_at);

CREATE INDEX idx_fact_check_findings_status_checked
  ON fact_check_findings(status, checked_at);

CREATE INDEX idx_fact_check_sources_finding
  ON fact_check_sources(finding_id);

COMMIT;
```

Create down migration:

```sql
BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_fact_check_sources_finding;
DROP INDEX IF EXISTS idx_fact_check_findings_status_checked;
DROP INDEX IF EXISTS idx_fact_check_findings_author_checked;
DROP INDEX IF EXISTS idx_fact_check_findings_chat_checked;
DROP INDEX IF EXISTS idx_fact_check_findings_dedup;
DROP TABLE IF EXISTS fact_check_sources;
DROP TABLE IF EXISTS fact_check_findings;
DROP TABLE IF EXISTS fact_check_runs;
DROP TABLE IF EXISTS fact_check_windows;
ALTER TABLE chats DROP COLUMN username;

COMMIT;
```

- [ ] **Step 5: Add entities and repository interfaces**

Keep entities as interfaces unless a class invariant is needed. Use null instead of explicit undefined fields.

Example `FactCheckWindowEntity.ts`:

```ts
export interface FactCheckWindowEntity {
  chatId: number;
  lastCheckedMessageId: number;
  lastCheckedAt: string | null;
  updatedAt: string;
}
```

Example repository id:

```ts
import type { ServiceIdentifier } from 'inversify';

export interface FactCheckWindowRepository {
  get(chatId: number): Promise<FactCheckWindowEntity | null>;
  upsert(window: FactCheckWindowEntity): Promise<void>;
}

export const FACT_CHECK_WINDOW_REPOSITORY_ID = Symbol.for(
  'FactCheckWindowRepository'
) as ServiceIdentifier<FactCheckWindowRepository>;
```

Define the fact-check repository contracts and the input/read-model types they reference. Put the entity/read-model types in the entity files and the input/query types alongside the segregated repository interfaces in `FactCheckRepository.ts` (the interfaces themselves are defined in Step 5 below):

```ts
// FactCheckSourceEntity.ts
import type { FactCheckSourceReliability } from '@/domain/fact-checking/FactCheckTypes';

export interface FactCheckSourceEntity {
  id: number;
  findingId: number;
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  reliability: FactCheckSourceReliability;
  retrievedAt: string;
}

// FactCheckFindingEntity.ts
import type {
  FactCheckCategory,
  FactCheckSeverity,
  FactCheckStatus,
  FactCheckSourcePolicy,
} from '@/domain/fact-checking/FactCheckTypes';

export interface FactCheckFindingEntity {
  id: number;
  runId: number;
  chatId: number;
  messageId: number;
  telegramMessageId: number | null;
  authorUserId: number | null;
  authorDisplayName: string;
  normalizedClaimKey: string;
  claimText: string;
  originalQuote: string;
  correctedFact: string;
  explanation: string;
  category: FactCheckCategory;
  severity: FactCheckSeverity;
  status: FactCheckStatus; // persisted findings are only 'confirmed' | 'uncertain'
  confidence: number;
  sourcePolicy: FactCheckSourcePolicy;
  sourceRequirementsMet: boolean;
  messageUrl: string | null;
  immediateNotifiedAt: string | null;
  digestNotifiedAt: string | null;
  notificationError: string | null;
  createdAt: string;
  checkedAt: string;
}

// Read model joining a finding with its sources (used by notifier/formatter).
export interface FactCheckFindingWithSources extends FactCheckFindingEntity {
  sources: FactCheckSourceEntity[];
}
```

```ts
// FactCheckRepository.ts — input/query types
import type {
  FactCheckCategory,
  FactCheckSeverity,
  FactCheckStatus,
  FactCheckSourcePolicy,
  FactCheckSourceReliability,
} from '@/domain/fact-checking/FactCheckTypes';

export interface CreateFactCheckRunInput {
  chatId: number;
  runType: 'hourly' | 'daily' | 'weekly' | 'monthly';
  startedAt: string;
  messageFromId: number | null;
  messageToId: number | null;
  extractorModel: string | null;
  verifierModel: string | null;
}

export interface CompleteFactCheckRunInput {
  runId: number;
  finishedAt: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  requestJson: unknown;
  responseJson: unknown;
}

export interface FailFactCheckRunInput {
  runId: number;
  finishedAt: string;
  errorMessage: string;
}

export interface InsertFactCheckSourceInput {
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  reliability: FactCheckSourceReliability;
  retrievedAt: string;
}

export interface InsertFactCheckFindingInput {
  runId: number;
  chatId: number;
  messageId: number;
  telegramMessageId: number | null;
  authorUserId: number | null;
  authorDisplayName: string;
  normalizedClaimKey: string;
  claimText: string;
  originalQuote: string;
  correctedFact: string;
  explanation: string;
  category: FactCheckCategory;
  severity: FactCheckSeverity;
  status: FactCheckStatus;
  confidence: number;
  sourcePolicy: FactCheckSourcePolicy;
  sourceRequirementsMet: boolean;
  messageUrl: string | null;
  createdAt: string;
  checkedAt: string;
  sources: readonly InsertFactCheckSourceInput[];
}

export type FactCheckStatsPeriod = 'daily' | 'weekly' | 'monthly';

export interface FactCheckStatsQuery {
  chatId: number;
  fromIso: string;
  toIso: string;
}

export interface FactCheckStatsRow {
  authorUserId: number | null;
  authorDisplayName: string;
  category: FactCheckCategory;
  status: FactCheckStatus;
  count: number;
}
```

**Segregate the repository into three role-specific interfaces (ISP)** so each client depends only on what it uses. Put all three (plus their DI ids) in `FactCheckRepository.ts`; a single SQLite class implements all three (bound to all three ids in Step 7):

```ts
// FactCheckRepository.ts — segregated interfaces
import type { ServiceIdentifier } from 'inversify';

// Used by the pipeline (run lifecycle).
export interface FactCheckRunRepository {
  createRun(input: CreateFactCheckRunInput): Promise<number>;
  completeRun(input: CompleteFactCheckRunInput): Promise<void>;
  failRun(input: FailFactCheckRunInput): Promise<void>;
}

// Used by the pipeline (insert) and the notifier (read + notification-state).
export interface FactCheckFindingRepository {
  insertFinding(input: InsertFactCheckFindingInput): Promise<number | null>;
  findUnsentImmediate(
    chatId: number,
    limit: number
  ): Promise<FactCheckFindingWithSources[]>;
  findUnsentDigest(
    chatId: number,
    limit: number
  ): Promise<FactCheckFindingWithSources[]>;
  markImmediateNotified(findingId: number, notifiedAt: string): Promise<void>;
  markDigestNotified(
    findingIds: readonly number[],
    notifiedAt: string
  ): Promise<void>;
  recordNotificationError(findingId: number, error: string): Promise<void>;
}

// Used by the stats service only.
export interface FactCheckStatsRepository {
  getStats(input: FactCheckStatsQuery): Promise<FactCheckStatsRow[]>;
}

export const FACT_CHECK_RUN_REPOSITORY_ID = Symbol.for(
  'FactCheckRunRepository'
) as ServiceIdentifier<FactCheckRunRepository>;
export const FACT_CHECK_FINDING_REPOSITORY_ID = Symbol.for(
  'FactCheckFindingRepository'
) as ServiceIdentifier<FactCheckFindingRepository>;
export const FACT_CHECK_STATS_REPOSITORY_ID = Symbol.for(
  'FactCheckStatsRepository'
) as ServiceIdentifier<FactCheckStatsRepository>;
```

Client → interface mapping:

- `DefaultFactCheckPipeline` → `FactCheckRunRepository` + `FactCheckFindingRepository`.
- `DefaultFactCheckNotifier` → `FactCheckFindingRepository`.
- `DefaultFactCheckStatsService` → `FactCheckStatsRepository`.

- [ ] **Step 6: Implement SQLite repositories**

`SQLiteFactCheckRepository` implements all three segregated interfaces (`FactCheckRunRepository`, `FactCheckFindingRepository`, `FactCheckStatsRepository`) in one class — the split is at the interface seam, not the implementation. Follow existing repository style:

- inject `DB_PROVIDER_ID`.
- use `db.run`, `db.get`, `db.all`.
- map snake_case rows to camelCase.
- JSON stringify `request_json`/`response_json` before insert.
- for deduplication, use `INSERT OR IGNORE` and return `null` if no row was inserted.
- `findUnsent*` join `fact_check_sources` per finding to return `FactCheckFindingWithSources`.

- [ ] **Step 7: Bind repositories**

In `src/container/repositories.ts`, bind the single implementation to all three role ids (same singleton instance). Inversify v7-alpha: bind the class to itself, then resolve it for each id (mirrors the `toDynamicValue(() => container.get(...))` style already used in `application.ts`):

```ts
container
  .bind(SQLiteFactCheckRepository)
  .toSelf()
  .inSingletonScope();
container
  .bind<FactCheckRunRepository>(FACT_CHECK_RUN_REPOSITORY_ID)
  .toDynamicValue(() => container.get(SQLiteFactCheckRepository))
  .inSingletonScope();
container
  .bind<FactCheckFindingRepository>(FACT_CHECK_FINDING_REPOSITORY_ID)
  .toDynamicValue(() => container.get(SQLiteFactCheckRepository))
  .inSingletonScope();
container
  .bind<FactCheckStatsRepository>(FACT_CHECK_STATS_REPOSITORY_ID)
  .toDynamicValue(() => container.get(SQLiteFactCheckRepository))
  .inSingletonScope();
container
  .bind<FactCheckWindowRepository>(FACT_CHECK_WINDOW_REPOSITORY_ID)
  .to(SQLiteFactCheckWindowRepository)
  .inSingletonScope();
```

- [ ] **Step 8: Run repository tests**

Run:

```powershell
pnpm test -- test/factCheckMigration022.test.ts test/SQLiteFactCheckRepository.test.ts test/SQLiteFactCheckWindowRepository.test.ts test/FactCheckMessageWindowRepository.test.ts test/sqliteRepositories.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```powershell
git add migrations/022_fact_checking.up.sql migrations/022_fact_checking.down.sql src/domain/entities/FactCheckRunEntity.ts src/domain/entities/FactCheckFindingEntity.ts src/domain/entities/FactCheckSourceEntity.ts src/domain/entities/FactCheckWindowEntity.ts src/domain/repositories/FactCheckRepository.ts src/domain/repositories/FactCheckWindowRepository.ts src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository.ts src/infrastructure/persistence/sqlite/SQLiteFactCheckWindowRepository.ts src/container/repositories.ts test/factCheckMigration022.test.ts test/SQLiteFactCheckRepository.test.ts test/SQLiteFactCheckWindowRepository.test.ts
git add src/infrastructure/persistence/sqlite/SQLiteChatRepository.ts src/domain/entities/ChatEntity.ts
git commit -m "feat(fact-check): add persistence"
```

## Task 5: Add Source Policy, Deduplication, Message Links, And Telegram Formatting

**Files:**

- Create: `src/application/fact-checking/FactCheckSourcePolicy.ts`
- Create: `src/application/fact-checking/FactCheckDeduplication.ts`
- Create: `src/application/fact-checking/FactCheckMessageLinks.ts`
- Create: `src/application/fact-checking/FactCheckFormatter.ts`
- Test: `test/FactCheckSourcePolicy.test.ts`
- Test: `test/FactCheckDeduplication.test.ts`
- Test: `test/FactCheckMessageLinks.test.ts`
- Test: `test/FactCheckFormatter.test.ts`

- [ ] **Step 1: Write failing source policy tests**

Test the key rules:

```ts
expect(canConfirmFinding({
  category: 'medical',
  sourcePolicy: 'primary_required',
  sourceRequirementsMet: false,
  sources: [{ reliability: 'media' }],
})).toBe(false);

expect(canConfirmFinding({
  category: 'external_fact',
  sourcePolicy: 'reliable_or_media_allowed',
  sourceRequirementsMet: true,
  sources: [{ reliability: 'media' }],
})).toBe(true);

expect(canConfirmFinding({
  category: 'chat_history',
  sourcePolicy: 'chat_history_only',
  sourceRequirementsMet: true,
  sources: [],
})).toBe(true);
```

- [ ] **Step 2: Write failing formatter tests**

Assert:

- `<`, `>`, `&`, and quotes are escaped in user/model text.
- links are not escaped as raw HTML when generated by formatter.
- digest separates confirmed and uncertain sections.
- max findings per message splits output into chunks.
- a chunk that would exceed the Telegram length limit is split further even
  below `maxFindingsPerDigestMessage`: build a long finding (long quote +
  explanation + sources) and assert no produced chunk exceeds ~4000 chars.

- [ ] **Step 3: Write failing message link tests**

Assert:

```ts
expect(buildTelegramMessageUrl({
  chatId: -1001234567890,
  chatUsername: null,
  telegramMessageId: 55,
})).toBe('https://t.me/c/1234567890/55');

expect(buildTelegramMessageUrl({
  chatId: -100123,
  chatUsername: 'mychat',
  telegramMessageId: 55,
})).toBe('https://t.me/mychat/55');
```

Also assert missing `telegramMessageId` returns null.

- [ ] **Step 4: Run failing tests**

Run:

```powershell
pnpm test -- test/FactCheckSourcePolicy.test.ts test/FactCheckDeduplication.test.ts test/FactCheckMessageLinks.test.ts test/FactCheckFormatter.test.ts
```

Expected: fail because files do not exist.

- [ ] **Step 5: Implement source policy**

`FactCheckSourcePolicy.ts` should expose small pure functions:

```ts
import type {
  FactCheckCategory,
  FactCheckSourcePolicy,
  FactCheckSourceReliability,
} from '@/domain/fact-checking/FactCheckTypes';

export interface SourcePolicyInput {
  category: FactCheckCategory;
  sourcePolicy: FactCheckSourcePolicy;
  sourceRequirementsMet: boolean;
  sources: readonly { reliability: FactCheckSourceReliability }[];
}

export function getSourcePolicyForCategory(
  category: FactCheckCategory
): FactCheckSourcePolicy {
  switch (category) {
    case 'chat_history':
      return 'chat_history_only';
    case 'medical':
    case 'legal':
    case 'financial':
    case 'safety':
      return 'primary_required';
    case 'external_fact':
    case 'mixed':
      return 'reliable_or_media_allowed';
  }
}

export function canConfirmFinding(input: SourcePolicyInput): boolean {
  if (!input.sourceRequirementsMet) return false;
  switch (input.sourcePolicy) {
    case 'chat_history_only':
      return input.category === 'chat_history';
    case 'primary_required':
      return input.sources.some((s) => s.reliability === 'primary');
    case 'reliable_or_media_allowed':
      return input.sources.some((s) =>
        ['primary', 'authoritative', 'media'].includes(s.reliability)
      );
  }
}
```

- [ ] **Step 6: Implement deduplication**

Use deterministic ASCII-friendly normalization:

```ts
export function normalizeClaimKey(claimText: string): string {
  return claimText
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/g, '');
}
```

- [ ] **Step 7: Implement message links**

`FactCheckMessageLinks.ts`:

```ts
export interface TelegramMessageLinkInput {
  chatId: number;
  chatUsername: string | null;
  telegramMessageId: number | null;
}

export function buildTelegramMessageUrl(
  input: TelegramMessageLinkInput
): string | null {
  if (input.telegramMessageId == null) return null;
  if (input.chatUsername != null && input.chatUsername.trim() !== '') {
    return `https://t.me/${input.chatUsername}/${input.telegramMessageId}`;
  }
  const text = String(input.chatId);
  if (text.startsWith('-100')) {
    return `https://t.me/c/${text.slice(4)}/${input.telegramMessageId}`;
  }
  return null;
}
```

- [ ] **Step 8: Implement Telegram HTML formatter**

Define the stats view-model in `FactCheckFormatter.ts` (imported by the stats service in Task 10):

```ts
import type { FactCheckStatsPeriod } from '@/domain/repositories/FactCheckRepository';

export interface FactCheckStatsUserRow {
  authorDisplayName: string;
  confirmed: number;
  uncertain: number;
}

export interface FactCheckStatsCategoryRow {
  category: string;
  confirmed: number;
  uncertain: number;
}

export interface FactCheckStatsReportInput {
  period: FactCheckStatsPeriod;
  fromIso: string;
  toIso: string;
  totalConfirmed: number;
  totalUncertain: number;
  topUsers: FactCheckStatsUserRow[];
  categories: FactCheckStatsCategoryRow[];
}
```

Expose:

```ts
escapeTelegramHtml(value: string): string;
formatImmediateFactCheck(finding: FactCheckFindingWithSources): string;
formatHourlyDigest(findings: readonly FactCheckFindingWithSources[], config: FactCheckConfig): string[];
formatStatsReport(input: FactCheckStatsReportInput): string;
```

Formatter rules:

- Russian chat-facing copy.
- `parse_mode: 'HTML'` compatibility.
- user/model text must be escaped.
- source links use `<a href="escaped-url">escaped-title</a>`.
- show max 1-3 source links based on config.
- confirmed and uncertain sections separate.
- chunking is byte-aware, not only count-aware: Telegram rejects messages over
  4096 chars. Cap each chunk at both `maxFindingsPerDigestMessage` findings AND
  a conservative `~4000`-char budget; if appending the next finding would
  exceed the budget, start a new chunk. Never split inside a finding's HTML
  (would break tags) — move the whole finding to the next chunk.

Immediate copy should be Russian, for example:

```html
<b>Фактчек</b>: похоже, тут важная фактическая ошибка

<blockquote>...</blockquote>

<b>Верно:</b> ...
<b>Почему важно:</b> ...
<b>Источники:</b> <a href="...">1</a>
```

- [ ] **Step 9: Run utility tests**

Run:

```powershell
pnpm test -- test/FactCheckSourcePolicy.test.ts test/FactCheckDeduplication.test.ts test/FactCheckMessageLinks.test.ts test/FactCheckFormatter.test.ts
```

Expected: pass.

- [ ] **Step 10: Commit**

```powershell
git add src/application/fact-checking/FactCheckSourcePolicy.ts src/application/fact-checking/FactCheckDeduplication.ts src/application/fact-checking/FactCheckMessageLinks.ts src/application/fact-checking/FactCheckFormatter.ts test/FactCheckSourcePolicy.test.ts test/FactCheckDeduplication.test.ts test/FactCheckMessageLinks.test.ts test/FactCheckFormatter.test.ts
git commit -m "feat(fact-check): add formatting and policy helpers"
```

## Task 6: Add Fact-Check Prompt Templates And PromptDirector Methods

**Files:**

- Create: `prompts/fact_check_claim_extraction_system_prompt.md`
- Create: `prompts/fact_check_verification_system_prompt.md`
- Create: `src/application/fact-checking/FactCheckPromptContext.ts`
- Modify: `src/application/interfaces/env/EnvService.ts`
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`
- Modify: `src/application/prompts/PromptBuilder.ts`
- Modify: `src/application/prompts/PromptDirector.ts`
- Test: `test/EnvService.test.ts`
- Test: `test/PromptBuilder.test.ts`
- Test: `test/PromptDirector.test.ts`

- [ ] **Step 1: Write failing prompt tests**

In `test/PromptDirector.test.ts`, add tests for:

```ts
await director.createFactCheckExtractionPrompt({
  batchMessages: [message],
  contextMessages: [],
});

await director.createFactCheckVerificationPrompt({
  candidates: [candidate],
  batchMessages: [message],
  contextMessages: [],
  sources: [source],
});
```

Assert the returned prompt includes system prompt content and message ids.

- [ ] **Step 2: Run failing prompt tests**

Run:

```powershell
pnpm test -- test/PromptBuilder.test.ts test/PromptDirector.test.ts
```

Expected: fail because prompt methods do not exist.

- [ ] **Step 3: Add prompt file entries**

Add to `PromptFiles`:

```ts
factCheckClaimExtractionSystem: string;
factCheckVerificationSystem: string;
```

Return paths in both `DefaultEnvService.getPromptFiles()` and `TestEnvService.getPromptFiles()`:

```ts
factCheckClaimExtractionSystem:
  'prompts/fact_check_claim_extraction_system_prompt.md',
factCheckVerificationSystem:
  'prompts/fact_check_verification_system_prompt.md',
```

**Update the existing strict assertion** in the `getPromptFiles returns default paths` test in `test/EnvService.test.ts` (it uses `toEqual({ ... })`); add the two new keys to that expected object, otherwise the test fails.

Note: `FilePromptTemplateService` resolves templates by `PromptFiles` key (e.g. `loadTemplate('factCheckClaimExtractionSystem')`), so the new keys must exist in `PromptFiles` and in both env services.

- [ ] **Step 4: Create prompt templates**

`prompts/fact_check_claim_extraction_system_prompt.md`:

```md
You are Carl's conservative claim extraction stage for a Russian Telegram chat.

Extract only clear, checkable factual claims from the provided messages.
Do not decide that anything is wrong.
Ignore jokes, opinions, predictions, taste judgments, vague interpretations,
and obvious hyperbole unless there is a concrete checkable factual claim.

Return strict JSON matching the provided schema.
Prefer fewer high-quality candidates over many weak candidates.
Use message ids from the input exactly.
Classify medical, legal, financial, and safety claims as high-stakes categories.
```

`prompts/fact_check_verification_system_prompt.md`:

```md
You are Carl's conservative fact verification stage for a Russian Telegram chat.

Verify candidate claims using the supplied chat context and sources.
Mark a finding as confirmed only when the correction is strongly supported.
If sources conflict, sources are missing, or the claim is ambiguous, use
uncertain or no_error.

For medical, legal, financial, and safety claims, confirmed requires primary or
professional sources. If that bar is not met, use uncertain at most.

Use neutral wording. Never accuse a person of lying.
Return strict JSON matching the provided schema.
```

- [ ] **Step 5: Add PromptBuilder methods**

Add methods that load templates through `PromptTemplateService`:

```ts
addFactCheckClaimExtractionSystem(): this
addFactCheckVerificationSystem(): this
addFactCheckMessages(params: FactCheckPromptMessages): this
addFactCheckCandidates(params: FactCheckPromptCandidates): this
addFactCheckSources(params: FactCheckPromptSources): this
```

Keep rendering deterministic and compact. Use JSON for message/candidate/source blocks rather than ad hoc prose.

- [ ] **Step 6: Add PromptDirector methods**

In `PromptDirector`:

```ts
async createFactCheckExtractionPrompt(context: FactCheckExtractionPromptContext): Promise<PromptMessage[]> {
  return this.builderFactory()
    .addFactCheckClaimExtractionSystem()
    .addFactCheckMessages({
      batchMessages: context.batchMessages,
      contextMessages: context.contextMessages,
    })
    .build();
}

async createFactCheckVerificationPrompt(context: FactCheckVerificationPromptContext): Promise<PromptMessage[]> {
  return this.builderFactory()
    .addFactCheckVerificationSystem()
    .addFactCheckMessages({
      batchMessages: context.batchMessages,
      contextMessages: context.contextMessages,
    })
    .addFactCheckCandidates({ candidates: context.candidates })
    .addFactCheckSources({ sources: context.sources })
    .build();
}
```

Define the context interfaces in a focused file `src/application/fact-checking/FactCheckPromptContext.ts` (keep them out of the noisy `PromptTypes.ts`). They are imported by both `PromptDirector` and the reasoning service (Task 7):

```ts
import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { ExtractedClaim } from '@/domain/fact-checking/FactCheckTypes';

// Structurally compatible with SourceSearchResult (Task 8). Defined here so the
// prompt layer does not depend on the source-search service.
export interface FactCheckPromptSource {
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  reliability: string;
}

export interface FactCheckExtractionPromptContext {
  batchMessages: ChatMessage[];
  contextMessages: ChatMessage[];
}

export interface FactCheckVerificationPromptContext {
  candidates: ExtractedClaim[];
  batchMessages: ChatMessage[];
  contextMessages: ChatMessage[];
  sources: FactCheckPromptSource[];
}
```

The `PromptDirector` methods return `Promise<PromptMessage[]>` (same as every other director method). The reasoning service maps `PromptMessage[]` to `AiMessage[]` with the same `toAiMessages` helper used in `DefaultBehaviorAiService`.

- [ ] **Step 7: Run prompt tests**

Run:

```powershell
pnpm test -- test/PromptBuilder.test.ts test/PromptDirector.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```powershell
git add prompts/fact_check_claim_extraction_system_prompt.md prompts/fact_check_verification_system_prompt.md src/application/interfaces/env/EnvService.ts src/infrastructure/config/DefaultEnvService.ts src/infrastructure/config/TestEnvService.ts src/application/prompts/PromptBuilder.ts src/application/prompts/PromptDirector.ts test/PromptBuilder.test.ts test/PromptDirector.test.ts
git commit -m "feat(fact-check): add AI prompts"
```

## Task 7: Add Fact-Check Reasoning Service

**Files:**

- Create: `src/application/fact-checking/FactCheckReasoningService.ts`
- Create: `src/application/fact-checking/DefaultFactCheckReasoningService.ts`
- Modify: `src/container/application.ts`
- Test: `test/DefaultFactCheckReasoningService.test.ts`
- Test: `test/container.fact-checking.test.ts`

- [ ] **Step 1: Write failing AI service tests**

Mock `AiGateway` (a fake object implementing `parseChatCompletion`). Do not mock the OpenAI SDK in this test. The fake returns `AiParsedResult<T>` shapes (`{ parsed, model, usage, raw }`). Construct the service with a fake `EnvService` (for the model slots) and a fake `FactCheckConfig` providing `verificationConfidenceThreshold: 0.75`. Assert:

- extraction calls `gateway.parseChatCompletion` with `model === env.getModels().factCheckExtraction.default`.
- extraction passes `responseFormat: claimExtractionResultJsonSchema`.
- verification starts with `factCheckVerification.default`.
- verification escalates to `factCheckVerification.escalation` when `parsed` is `null` or a finding confidence is below threshold (re-calls the gateway with the escalation model).
- verification passes `responseFormat: factVerificationResultJsonSchema`.
- the returned `FactCheckAiResult.metadata` includes `usage` (from `result.usage`), `latencyMs`, `selectedModel`, and `escalated`.
- `FactCheckAiResult.responseJson` equals the gateway result's `raw`.

- [ ] **Step 2: Run failing tests**

Run:

```powershell
pnpm test -- test/DefaultFactCheckReasoningService.test.ts
```

Expected: fail because service does not exist.

- [ ] **Step 3: Define interface**

Create `src/application/fact-checking/FactCheckReasoningService.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

import type { AiUsage } from '@/application/interfaces/ai/AiGateway';
import type {
  FactCheckExtractionPromptContext,
  FactCheckVerificationPromptContext,
} from '@/application/fact-checking/FactCheckPromptContext';
import type {
  ClaimExtractionResult,
  FactVerificationResult,
} from '@/domain/fact-checking/FactCheckSchemas';

export interface FactCheckAiMetadata {
  modelSlot: string;
  selectedModel: string;
  escalated: boolean;
  escalationReason: string | null;
  latencyMs: number;
  // Mirror the gateway's AiUsage shape; the pipeline maps these to the run row.
  usage: AiUsage;
}

export interface FactCheckAiResult<T> {
  result: T;
  metadata: FactCheckAiMetadata;
  requestJson: unknown;
  responseJson: unknown;
}

export interface FactCheckReasoningService {
  extractClaims(input: FactCheckExtractionPromptContext): Promise<FactCheckAiResult<ClaimExtractionResult>>;
  verifyClaims(input: FactCheckVerificationPromptContext): Promise<FactCheckAiResult<FactVerificationResult>>;
}

export const FACT_CHECK_REASONING_SERVICE_ID = Symbol.for(
  'FactCheckReasoningService'
) as ServiceIdentifier<FactCheckReasoningService>;
```

`AiUsage` is `{ promptTokens: number | null; completionTokens: number | null; totalTokens: number | null }` from the gateway. The pipeline (Task 9) maps `metadata.usage.promptTokens` → run `prompt_tokens`, etc. Use the prompt context types created in Task 6.

- [ ] **Step 4: Implement reasoning service**

Create `DefaultFactCheckReasoningService` using the same business-service
pattern as `DefaultBehaviorAiService` (`src/application/behavior/DefaultBehaviorAiService.ts`):

- inject `ENV_SERVICE_ID`, `PROMPT_DIRECTOR_ID`, `AI_GATEWAY_ID` (type `AiGateway`), `FACT_CHECK_CONFIG_ID` (type `FactCheckConfig`, for `verificationConfidenceThreshold`), `LOGGER_FACTORY_ID`.
- build the prompt via `PromptDirector.createFactCheckExtractionPrompt` / `createFactCheckVerificationPrompt`, then map to `AiMessage[]` with a `toAiMessages(prompt: PromptMessage[])` helper (copy from `DefaultBehaviorAiService`).
- call `gateway.parseChatCompletion<T>({ model, messages, responseFormat, parse })`.
- the gateway returns `AiParsedResult<T> = { parsed, model, usage, raw }`. Read `result.parsed` (may be `null`), `result.usage`, `result.raw`.
- validate with the full Zod schemas (the `parse` callback already does `schema.parse(JSON.parse(content))`; if `result.parsed` is `null`, treat as a parse failure).
- log prompt only if `LOG_PROMPTS` (reuse the `prompts.log` file-append helper from `DefaultBehaviorAiService`).
- set `requestJson` to the serialized `AiMessage[]` and `responseJson` to `result.raw` for run audit.

Minimal structure (extraction):

```ts
const start = Date.now();
const result = await this.gateway.parseChatCompletion<ClaimExtractionResult>({
  model: this.extractionModel,
  messages,
  responseFormat: claimExtractionResultJsonSchema,
  parse: (content) =>
    claimExtractionResultSchema.parse(JSON.parse(content) as unknown),
});
const latencyMs = Date.now() - start;
if (result.parsed == null) {
  throw new Error('Failed to parse fact-check extraction response');
}
// result.parsed -> FactCheckAiResult.result
// result.usage  -> metadata.usage
// result.raw    -> responseJson
```

Verification escalation rule (mirror the escalation loop in `DefaultBehaviorAiService.decideBehavior`):

- if `result.parsed` is `null` (validation/parse failure), retry once with the escalation model.
- if any returned finding has `status !== 'no_error'` and `confidence < this.config.verificationConfidenceThreshold` (default `0.75`, from `FactCheckConfig`), retry once with the escalation model.
- if escalation also returns `null`, throw.

- [ ] **Step 5: Bind service**

In `container/application.ts`:

```ts
container
  .bind<FactCheckReasoningService>(FACT_CHECK_REASONING_SERVICE_ID)
  .to(DefaultFactCheckReasoningService)
  .inSingletonScope();
```

Also bind `FACT_CHECK_CONFIG_ID` to `envService.getFactCheckConfig()`.

- [ ] **Step 6: Add DI test**

In `test/container.fact-checking.test.ts`, assert:

```ts
expect(container.get(FACT_CHECK_CONFIG_ID)).toBeTruthy();
expect(container.get(FACT_CHECK_REASONING_SERVICE_ID)).toBeTruthy();
```

- [ ] **Step 7: Run AI tests**

Run:

```powershell
pnpm test -- test/DefaultFactCheckReasoningService.test.ts test/container.fact-checking.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```powershell
git add src/application/fact-checking/FactCheckReasoningService.ts src/application/fact-checking/DefaultFactCheckReasoningService.ts src/container/application.ts test/DefaultFactCheckReasoningService.test.ts test/container.fact-checking.test.ts
git commit -m "feat(fact-check): add reasoning service"
```

## Task 8: Add Source Search Service

**Files:**

- Create: `src/application/fact-checking/SourceSearchService.ts`
- Create: `src/application/fact-checking/DefaultFactCheckSourceSearchService.ts`
- Modify: `src/container/application.ts`
- Test: `test/DefaultFactCheckSourceSearchService.test.ts`
- Test: `test/container.fact-checking.test.ts`

- [ ] **Step 1: Run documentation checkpoint**

Per `AGENTS.md`, fetch current OpenAI Node SDK docs before writing the production source search service:

```powershell
npx ctx7@latest library "OpenAI Node SDK" "OpenAI Responses API web search TypeScript sources citations"
```

After selecting the official OpenAI Node SDK Context7 library id from the first
command, run:

```powershell
npx ctx7@latest docs /openai/openai-node "OpenAI Responses API web search TypeScript sources citations"
```

If the `library` output shows a more exact official OpenAI SDK id or
version-specific id, use that exact id instead of `/openai/openai-node`.

Run outside Codex's default sandbox. If the command fails with DNS/network errors in sandbox, rerun with escalation as required by the repo instructions.

- [ ] **Step 2: Write failing source search tests**

Mock `AiGateway` (fake with a `createResponse` returning `{ outputText, usage, raw }`) and assert:

- `search()` calls `gateway.createResponse()`.
- it uses the configured source search model (`env.getModels().sourceSearch.default`).
- it passes a web search tool in `tools`.
- it returns normalized sources with URL, title, snippet, `publisher: null` when unknown, and reliability.
- it caps results to `maxSources`.
- empty/no-citation responses return `[]` (no throw).

- [ ] **Step 3: Run failing source search tests**

Run:

```powershell
pnpm test -- test/DefaultFactCheckSourceSearchService.test.ts
```

Expected: fail because service does not exist.

- [ ] **Step 4: Define source interface**

Create `SourceSearchService.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

import type { FactCheckSourceReliability } from '@/domain/fact-checking/FactCheckTypes';

export interface SourceSearchRequest {
  claimText: string;
  category: string;
  maxSources: number;
}

export interface SourceSearchResult {
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  reliability: FactCheckSourceReliability;
  retrievedAt: string;
}

export interface SourceSearchService {
  search(request: SourceSearchRequest): Promise<SourceSearchResult[]>;
}

export const SOURCE_SEARCH_SERVICE_ID = Symbol.for(
  'SourceSearchService'
) as ServiceIdentifier<SourceSearchService>;
```

- [ ] **Step 5: Implement default fact-check source search**

Use the exact API shape from the documentation checkpoint. The implementation should:

- inject `ENV_SERVICE_ID`, `FACT_CHECK_CONFIG_ID`, `AI_GATEWAY_ID` (type `AiGateway`), `LOGGER_FACTORY_ID`.
- call `gateway.createResponse({ model, input, tools })` with the web search tool in `tools` (e.g. `[{ type: 'web_search' }]` — confirm the exact tool name/shape from the ctx7 docs checkpoint).
- ask for sources only, not a fact-check verdict.
- parse citations/annotations from `result.raw` (the gateway's `createResponse` returns `{ outputText, usage, raw }`; the raw OpenAI `Response` carries `output[].content[].annotations`). Extract a pure helper for this and unit-test it. If the ctx7 docs show that retrieving annotations requires request params the current `AiGateway.createResponse({ model, input, tools })` signature does not expose, extend that gateway method minimally (keep it provider-neutral) and update `OpenAiSdkGateway` accordingly.
- normalize returned annotations/citations into `SourceSearchResult[]`.
- if an annotation has no usable snippet/publisher (common — see Known Risks),
  set `snippet: ''` (the DB `snippet` column is NOT NULL — never insert null) and
  `publisher: null`. The verification prompt and the formatter must tolerate an
  empty snippet. Optionally derive a short snippet from `outputText` if the ctx7
  doc-check shows that is the only available text.
- classify reliability with a small deterministic heuristic:
  - `.gov`, `.edu`, official docs, standards bodies: `primary`.
  - major reference/professional institutions: `authoritative`.
  - known news/media domains: `media`.
  - otherwise: `weak`.
- never throw on empty results; return `[]`.
- throw only for transport/API errors so the pipeline can record partial failure.

Keep the service small. If response parsing becomes complex, extract a pure helper and test it separately.

- [ ] **Step 6: Bind source search**

In `container/application.ts`:

```ts
container
  .bind<SourceSearchService>(SOURCE_SEARCH_SERVICE_ID)
  .to(DefaultFactCheckSourceSearchService)
  .inSingletonScope();
```

Update `container.fact-checking.test.ts`.

- [ ] **Step 7: Run tests**

Run:

```powershell
pnpm test -- test/DefaultFactCheckSourceSearchService.test.ts test/container.fact-checking.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```powershell
git add src/application/fact-checking/SourceSearchService.ts src/application/fact-checking/DefaultFactCheckSourceSearchService.ts src/container/application.ts test/DefaultFactCheckSourceSearchService.test.ts test/container.fact-checking.test.ts
git commit -m "feat(fact-check): add source search"
```

## Task 9: Add FactCheckPipeline

**Files:**

- Create: `src/application/fact-checking/FactCheckPipeline.ts`
- Create: `src/application/fact-checking/DefaultFactCheckPipeline.ts`
- Modify: `src/container/application.ts`
- Test: `test/DefaultFactCheckPipeline.test.ts`
- Test: `test/container.fact-checking.test.ts`

- [ ] **Step 1: Write failing pipeline tests**

Use fake dependencies. Test:

- disabled config returns `skipped_disabled`.
- no new messages returns `skipped_no_messages`.
- extractor claims are capped by `maxClaimsPerBatch`.
- source search runs only for candidates that need external sources.
- high-stakes missing primary/professional sources downgrades confirmed to uncertain.
- `no_error` verification findings are not persisted.
- watermark advances only after persistence.
- watermark is hole-safe: with a `pending` message mid-window, the loaded batch
  stops before it and the cursor advances only to the last contiguous ready id
  (drive this through the fake `FactCheckMessageWindowRepository` returning the
  bounded batch; assert `cursorRepo.upsert` is called with that id, not beyond).
- notifier is called after persistence.
- source search failure records a failed or partial run and does not throw out of the whole scheduler path.

- [ ] **Step 2: Run failing pipeline tests**

Run:

```powershell
pnpm test -- test/DefaultFactCheckPipeline.test.ts
```

Expected: fail because pipeline does not exist.

- [ ] **Step 3: Define pipeline interface**

`FactCheckPipeline.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

export type FactCheckRunOutcome =
  | 'completed'
  | 'partial'
  | 'failed'
  | 'skipped_disabled'
  | 'skipped_no_messages';

export interface FactCheckRunResult {
  chatId: number;
  outcome: FactCheckRunOutcome;
  runId: number | null;
  processedMessages: number;
  persistedFindings: number;
}

export interface FactCheckPipeline {
  runHourly(chatId: number): Promise<FactCheckRunResult>;
  runStats(chatId: number, period: 'daily' | 'weekly' | 'monthly'): Promise<FactCheckRunResult>;
}

export const FACT_CHECK_PIPELINE_ID = Symbol.for(
  'FactCheckPipeline'
) as ServiceIdentifier<FactCheckPipeline>;
```

- [ ] **Step 4: Implement hourly orchestration**

Inject only the narrow interfaces this orchestrator needs: `FACT_CHECK_CONFIG_ID`, `FACT_CHECK_MESSAGE_WINDOW_REPOSITORY_ID` (the isolated read port — not `MessageService`), `CHAT_REPOSITORY_ID` (to resolve `chat.username` for message links), `FACT_CHECK_REASONING_SERVICE_ID`, `SOURCE_SEARCH_SERVICE_ID`, `FACT_CHECK_RUN_REPOSITORY_ID`, `FACT_CHECK_FINDING_REPOSITORY_ID`, `FACT_CHECK_WINDOW_REPOSITORY_ID` (watermark), `FACT_CHECK_NOTIFIER_ID`, `LOGGER_FACTORY_ID`.

`DefaultFactCheckPipeline.runHourly(chatId)` flow (`windowRepo` = the message window port; `cursorRepo` = the watermark `FactCheckWindowRepository`):

1. if config disabled, return `skipped_disabled`.
2. get cursor via `cursorRepo.get(chatId)`, default `lastCheckedMessageId = 0`.
3. load batch via `windowRepo.findReadyByChatIdAfterId(chatId, lastCheckedMessageId, maxMessagesPerBatch)`.
4. if no messages, return `skipped_no_messages`.
5. load context via `windowRepo.findReadyContextBeforeId(chatId, firstBatchId, maxHistoryContextMessages)`.
6. resolve `chat = await chatRepo.findById(chatId)` once; keep `chat?.username ?? null` for link building.
7. create run row.
8. call AI extraction.
9. cap claims to `maxClaimsPerBatch`.
10. source search only as needed (`needsExternalSources`) and only up to `maxSourceSearchesPerBatch`.
11. call AI verification.
12. apply source policy and normalize statuses (drop `no_error`; downgrade high-stakes `confirmed` lacking required sources to `uncertain`).
13. for each persisted finding, build `messageUrl` with `buildTelegramMessageUrl({ chatId, chatUsername, telegramMessageId })`.
14. persist confirmed and uncertain findings with sources (dedup via unique `message_id + normalized_claim_key`).
15. complete run (map `metadata.usage.promptTokens/completionTokens/totalTokens` to run columns).
16. notify.
17. update the watermark via `cursorRepo.upsert(...)` to the max processed message id. This is now hole-safe: the window port (Task 3) already excludes anything at/after the first still-`pending` message, so "max processed id" is the end of a contiguous ready prefix and cannot leapfrog a `pending` voice message. `failed` messages are deliberately not holes.

Use `try/catch`:

- if persistence has not happened and a fatal error occurs, fail run and do not update window.
- if notification fails, record notification error and keep persisted findings.
- if source search fails for some claims, allow uncertain findings when verification can proceed; otherwise mark run partial.

- [ ] **Step 5: Use pure helpers for mapping**

Extract pure private helpers if the class grows:

- build author display name from `fullName`, `username`, `userId`.
- build original quote from message content with truncation.
- resolve `sourcePolicy` from category.
- normalize verification result into insert input.

- [ ] **Step 6: Bind pipeline**

In `container/application.ts`, bind:

```ts
container
  .bind<FactCheckPipeline>(FACT_CHECK_PIPELINE_ID)
  .to(DefaultFactCheckPipeline)
  .inSingletonScope();
```

- [ ] **Step 7: Run pipeline tests**

Run:

```powershell
pnpm test -- test/DefaultFactCheckPipeline.test.ts test/container.fact-checking.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```powershell
git add src/application/fact-checking/FactCheckPipeline.ts src/application/fact-checking/DefaultFactCheckPipeline.ts src/container/application.ts test/DefaultFactCheckPipeline.test.ts test/container.fact-checking.test.ts
git commit -m "feat(fact-check): add batch pipeline"
```

## Task 10: Add Notifier And Stats Service

**Files:**

- Create: `src/application/fact-checking/FactCheckNotifier.ts`
- Create: `src/application/fact-checking/DefaultFactCheckNotifier.ts`
- Create: `src/application/fact-checking/FactCheckStatsService.ts` (interface + `FACT_CHECK_STATS_SERVICE_ID`)
- Create: `src/application/fact-checking/DefaultFactCheckStatsService.ts` (implementation bound in the container)
- Modify: `src/container/application.ts`
- Test: `test/DefaultFactCheckNotifier.test.ts`
- Test: `test/FactCheckStatsService.test.ts`

- [ ] **Step 1: Write failing notifier tests**

With fake `ChatMessenger` and fake repository, test:

- immediate high-stakes confirmed finding sends `reply_to_message_id`.
- `parse_mode: 'HTML'` is passed.
- digest sends confirmed and uncertain sections.
- immediate-notified findings are not repeated as full digest entries.
- notification error is recorded if messenger throws.

- [ ] **Step 2: Write failing stats tests**

Test that stats:

- count confirmed and uncertain separately.
- rank users by confirmed count.
- include category counts.
- build daily, weekly, and monthly date ranges from an injected clock or explicit `now`.

- [ ] **Step 3: Run failing tests**

Run:

```powershell
pnpm test -- test/DefaultFactCheckNotifier.test.ts test/FactCheckStatsService.test.ts
```

Expected: fail because services do not exist.

- [ ] **Step 4: Define notifier interface**

```ts
import type { ServiceIdentifier } from 'inversify';

export interface FactCheckNotifier {
  sendImmediate(chatId: number): Promise<void>;
  sendHourlyDigest(chatId: number): Promise<void>;
  sendStats(chatId: number, period: 'daily' | 'weekly' | 'monthly'): Promise<void>;
}

export const FACT_CHECK_NOTIFIER_ID = Symbol.for(
  'FactCheckNotifier'
) as ServiceIdentifier<FactCheckNotifier>;
```

- [ ] **Step 5: Implement notifier**

Inject `FACT_CHECK_FINDING_REPOSITORY_ID` (type `FactCheckFindingRepository` — the notifier needs only `findUnsent*` / `mark*Notified` / `recordNotificationError`, not the run or stats methods), `CHAT_MESSENGER_ID`, and `FACT_CHECK_CONFIG_ID`. Use `FactCheckFormatter` and `ChatMessenger.sendMessage`.

Immediate send:

```ts
await this.messenger.sendMessage(chatId, html, {
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: true },
  reply_parameters: telegramMessageId
    ? { message_id: telegramMessageId, allow_sending_without_reply: true }
    : undefined,
});
```

Use `reply_parameters`; `ChatMessenger.sendMessage` already forwards the
`extra` object directly to grammY's `bot.api.sendMessage`.

Digest send:

- load unsent digest findings.
- format chunks.
- send each chunk with `parse_mode: 'HTML'`.
- mark only after successful send.

- [ ] **Step 6: Implement stats service**

In `FactCheckStatsService.ts` expose the interface and DI id:

```ts
import type { ServiceIdentifier } from 'inversify';

import type { FactCheckStatsReportInput } from '@/application/fact-checking/FactCheckFormatter';
import type { FactCheckStatsPeriod } from '@/domain/repositories/FactCheckRepository';

export interface FactCheckStatsService {
  buildReport(
    chatId: number,
    period: FactCheckStatsPeriod,
    now: Date
  ): Promise<FactCheckStatsReportInput>;
}

export const FACT_CHECK_STATS_SERVICE_ID = Symbol.for(
  'FactCheckStatsService'
) as ServiceIdentifier<FactCheckStatsService>;
```

Implement `DefaultFactCheckStatsService`: inject `FACT_CHECK_STATS_REPOSITORY_ID` (type `FactCheckStatsRepository` — only `getStats`) and use the `now` arg as the clock. Compute the `[fromIso, toIso]` window for the period, call `statsRepo.getStats({ chatId, fromIso, toIso })`, and aggregate the `FactCheckStatsRow[]` into a `FactCheckStatsReportInput` (totals, per-user confirmed/uncertain counts ranked by confirmed, per-category counts). The formatter renders the final Telegram text.

- [ ] **Step 7: Bind services**

In `container/application.ts`:

```ts
container
  .bind<FactCheckNotifier>(FACT_CHECK_NOTIFIER_ID)
  .to(DefaultFactCheckNotifier)
  .inSingletonScope();
container
  .bind<FactCheckStatsService>(FACT_CHECK_STATS_SERVICE_ID)
  .to(DefaultFactCheckStatsService)
  .inSingletonScope();
```

- [ ] **Step 8: Run notifier and stats tests**

Run:

```powershell
pnpm test -- test/DefaultFactCheckNotifier.test.ts test/FactCheckStatsService.test.ts test/container.fact-checking.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

```powershell
git add src/application/fact-checking/FactCheckNotifier.ts src/application/fact-checking/DefaultFactCheckNotifier.ts src/application/fact-checking/FactCheckStatsService.ts src/application/fact-checking/DefaultFactCheckStatsService.ts src/container/application.ts test/DefaultFactCheckNotifier.test.ts test/FactCheckStatsService.test.ts test/container.fact-checking.test.ts
git commit -m "feat(fact-check): add notifications and stats"
```

## Task 11: Add Scheduler, Manual Jobs, And Application Startup

**Files:**

- Create: `src/application/fact-checking/FactCheckScheduler.ts`
- Create: `src/application/fact-checking/DefaultFactCheckScheduler.ts`
- Modify: `src/application/interfaces/scheduler/ManualJobRunner.ts`
- Modify: `src/application/use-cases/scheduler/DefaultManualJobRunner.ts`
- Modify: `src/manual-job.ts`
- Modify: `src/container/application.ts`
- Modify: `src/view/telegram/MainService.ts`
- Test: `test/FactCheckScheduler.test.ts`
- Test: `test/ManualJobRunner.test.ts`
- Test: `test/MainService.test.ts`
- Test: `test/container.fact-checking.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Use fake `ChatApprovalService`, `FactCheckPipeline`, and logger.

Test:

- `start()` is no-op when disabled.
- `start()` registers cron jobs when enabled.
- hourly sweep calls pipeline for approved chats only.
- stats jobs call `runStats`.
- `stop()` stops tasks.
- errors for one chat do not prevent other chats from running.

- [ ] **Step 2: Write failing manual job tests**

Add job names:

- `fact-check-hourly`
- `fact-check-daily`
- `fact-check-weekly`
- `fact-check-monthly`

Assert parser accepts:

```powershell
node dist/manual-job.js fact-check-hourly --chat-id 123
```

- [ ] **Step 3: Run failing tests**

Run:

```powershell
pnpm test -- test/FactCheckScheduler.test.ts test/ManualJobRunner.test.ts test/MainService.test.ts
```

Expected: fail because scheduler/manual jobs are not wired.

- [ ] **Step 4: Define scheduler interface**

```ts
import type { ServiceIdentifier } from 'inversify';

export interface FactCheckScheduler {
  start(): void;
  stop(): void;
  runHourlyNow(): Promise<void>;
  runStatsNow(period: 'daily' | 'weekly' | 'monthly'): Promise<void>;
}

export const FACT_CHECK_SCHEDULER_ID = Symbol.for(
  'FactCheckScheduler'
) as ServiceIdentifier<FactCheckScheduler>;
```

- [ ] **Step 5: Implement scheduler**

Use `node-cron` like existing schedulers (`DefaultStateEvolutionScheduler.ts`
imports `cron, { type ScheduledTask } from 'node-cron'` and calls
`cron.schedule(expr, fn)` with **no** options).

**Capability check first:** the existing scheduler passes no options, so the
`{ timezone }` 3rd arg and the 6-field (seconds) cron expressions used here
(`'0 0 * * * *'`, `'0 0 9 * * *'`, …) are a new dependency surface. Before
relying on them, confirm the installed `node-cron` version in `package.json`
supports both `cron.schedule(expr, fn, { timezone })` and the optional seconds
field. If the installed version does not, fall back to 5-field crons and/or drop
the timezone option (and document the effective timezone).

- inject `FACT_CHECK_CONFIG_ID`, `CHAT_APPROVAL_SERVICE_ID`, `FACT_CHECK_PIPELINE_ID`, logger.
- keep `ScheduledTask[]`.
- in `start()`, if disabled or already started return.
- schedule four cron tasks with configured timezone.
- list approved chats through `ChatApprovalService.listAll()` and filter `status === 'approved'`.
- call pipeline per chat sequentially for MVP.

- [ ] **Step 6: Add manual jobs**

Update `ManualJobName` in `src/application/interfaces/scheduler/ManualJobRunner.ts`:

```ts
export type ManualJobName =
  | 'state-evolution'
  | 'topic-of-day'
  | 'fact-check-hourly'
  | 'fact-check-daily'
  | 'fact-check-weekly'
  | 'fact-check-monthly';
```

Also extend the `ManualJobRunResult` discriminated union (it is keyed by `job`) with a variant for the fact-check jobs, carrying the `FactCheckRunResult` (Task 9):

```ts
  | {
      job:
        | 'fact-check-hourly'
        | 'fact-check-daily'
        | 'fact-check-weekly'
        | 'fact-check-monthly';
      chatId: number;
      outcome: FactCheckRunOutcome;
      factCheck: FactCheckRunResult;
    };
```

Update `DefaultManualJobRunner` to inject `FACT_CHECK_PIPELINE_ID` (third constructor parameter) and handle the new `switch` cases. Prefer pipeline for chat-scoped jobs:

- `fact-check-hourly`: `pipeline.runHourly(chatId)`.
- stats jobs (`fact-check-daily|weekly|monthly`): `pipeline.runStats(chatId, period)`.

**Update the existing `test/ManualJobRunner.test.ts`** — it constructs `new DefaultManualJobRunner(topicScheduler, stateEvolutionPass)` positionally, so adding the pipeline dependency breaks it. Pass a fake pipeline as the third argument in both existing tests, and add new tests covering the four fact-check job names.

Update `src/manual-job.ts`: extend `isManualJobName`, the `usage` lines, and (since the new jobs need a chat id) keep `--chat-id` required.

- [ ] **Step 7: Wire startup**

In `MainService` constructor inject `FACT_CHECK_SCHEDULER_ID` with `LazyServiceIdentifier`, matching existing scheduler style.

In `launch()`:

```ts
try {
  this.factCheckScheduler.start();
} catch (error) {
  this.logger.error({ error }, 'Failed to start fact-check scheduler');
}
```

In `stop(reason)`:

```ts
this.factCheckScheduler.stop();
this.messenger.stop(reason);
```

- [ ] **Step 8: Bind scheduler**

In `container/application.ts`:

```ts
container
  .bind<FactCheckScheduler>(FACT_CHECK_SCHEDULER_ID)
  .to(DefaultFactCheckScheduler)
  .inSingletonScope();
```

- [ ] **Step 9: Run scheduler tests**

Run:

```powershell
pnpm test -- test/FactCheckScheduler.test.ts test/ManualJobRunner.test.ts test/MainService.test.ts test/container.fact-checking.test.ts
```

Expected: pass.

- [ ] **Step 10: Commit**

```powershell
git add src/application/fact-checking/FactCheckScheduler.ts src/application/fact-checking/DefaultFactCheckScheduler.ts src/application/interfaces/scheduler/ManualJobRunner.ts src/application/use-cases/scheduler/DefaultManualJobRunner.ts src/manual-job.ts src/container/application.ts src/view/telegram/MainService.ts test/FactCheckScheduler.test.ts test/ManualJobRunner.test.ts test/MainService.test.ts test/container.fact-checking.test.ts
git commit -m "feat(fact-check): schedule fact checks"
```

## Task 12: Add End-to-End Integration Coverage

**Files:**

- Create: `test/FactCheckIntegration.test.ts`
- Modify: any previous fact-check tests if interfaces changed.

- [ ] **Step 1: Write integration test with fake AI/search/messenger**

Use a temp DB with migrations and real SQLite repositories. Use fake:

- `FactCheckReasoningService`
- `SourceSearchService`
- `ChatMessenger`

Scenario:

1. approve chat.
2. insert two ready user messages.
3. run `pipeline.runHourly(chatId)`.
4. fake extraction returns one external fact claim.
5. fake search returns one authoritative source.
6. fake verification returns confirmed finding.
7. assert finding and source exist in DB.
8. assert digest/immediate notification path was called as expected.
9. assert window advanced to the latest processed message id.

**Watermark stop-at-hole (end-to-end).** Add a variant using real SQLite repos:
insert id=1 `ready`, id=2 `pending` (voice mid-transcription), id=3 `ready`. Run
`runHourly` and assert (a) only message id=1 was processed and (b) the watermark
is `1`, not `3` (id=3 was not leapfrogged past the pending hole). Then update
id=2 to `ready`, run again, and assert the watermark advances to `3` and id=2/id=3
get processed. This is the regression guard for the leapfrog bug at the
integration seam (window port + pipeline + cursor together).

- [ ] **Step 2: Add high-stakes integration case**

Same setup, but category `medical`, verification returns confirmed, search returns only `media`.

Expected:

- persisted finding status is `uncertain`.
- immediate notification is not sent as confirmed high-stakes.
- uncertain section appears in digest.

- [ ] **Step 3: Run integration test**

Run:

```powershell
pnpm test -- test/FactCheckIntegration.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```powershell
git add test/FactCheckIntegration.test.ts
git commit -m "test(fact-check): cover pipeline integration"
```

## Task 13: Final Verification And Cleanup

**Files:**

- Potentially modify files touched by lint/format fixes.

- [ ] **Step 1: Run auto-fix commands first**

Follow `CLAUDE.md` preference:

```powershell
pnpm lint:fix
pnpm format:fix
```

Expected: completes successfully or makes mechanical formatting changes.

- [ ] **Step 2: Run targeted fact-check tests**

Run:

```powershell
pnpm test -- test/factCheckSchemas.test.ts test/FactCheckSourcePolicy.test.ts test/FactCheckFormatter.test.ts test/FactCheckMessageLinks.test.ts test/FactCheckDeduplication.test.ts test/factCheckMigration022.test.ts test/SQLiteFactCheckRepository.test.ts test/SQLiteFactCheckWindowRepository.test.ts test/FactCheckMessageWindowRepository.test.ts test/DefaultFactCheckReasoningService.test.ts test/DefaultFactCheckSourceSearchService.test.ts test/DefaultFactCheckPipeline.test.ts test/DefaultFactCheckNotifier.test.ts test/FactCheckStatsService.test.ts test/FactCheckScheduler.test.ts test/FactCheckIntegration.test.ts test/container.fact-checking.test.ts
```

Expected: pass.

- [ ] **Step 3: Run full test suite**

Run:

```powershell
pnpm test
```

Expected: pass.

- [ ] **Step 4: Run type check and build**

Run:

```powershell
pnpm type:check
pnpm build
```

Expected: pass.

- [ ] **Step 5: Check git diff**

Run:

```powershell
git status --short
git diff --stat
```

Expected:

- fact-check code, tests, migrations, prompts, and env docs changed.
- `docs/superpowers/...` remains untracked or ignored and is not staged.
- unrelated user changes are not reverted.

- [ ] **Step 6: Final commit**

If lint/format changed files after the last task:

```powershell
git add <fact-check files changed by format or lint>
git commit -m "chore(fact-check): finalize implementation"
```

Do not commit `docs/superpowers/...`.

## Implementation Notes

- Keep the feature disabled by default with `FACT_CHECK_ENABLED=false`.
- Do not add an appeal/dispute UI in MVP.
- Do not mix this into the behavior pipeline.
- Keep public text Russian and neutral.
- Always HTML-escape user and model text before Telegram output.
- Preserve separate `confirmed` and `uncertain` counts.
- Do not let search failure erase or skip already persisted findings.
- Watermark updates must happen after successful persistence.
- For high-stakes topics, confirmed requires source policy success.
- Avoid `any` and `@ts-` directives.
- Prefer `null` over explicit `undefined` types in new domain data.
- Use pattern matching with `switch` where it improves clarity over nested ternaries.

## Known Risks & Accepted Decisions (MVP)

These are real behaviors of the feature **as designed**. They were reviewed and
explicitly accepted for the MVP (or fixed where noted). Read them before
implementing the affected task — they are not TODOs to silently "improve away."

- **Public immediate corrections — ACCEPTED (kept by product decision).**
  Immediate `reply_to_message_id` corrections stay on for high-stakes
  `confirmed` findings (Task 10). This is the highest-blast-radius, least
  reversible action: a public, in-chat call-out of a user's claim, in Russian,
  with no appeal/dispute path in MVP. Residual risk accepted; mitigations in the
  design are the conservative two-stage prompts, the source-policy gate
  (`canConfirmFinding`), and the feature flag (`FACT_CHECK_ENABLED=false` by
  default). Do **not** silently switch to digest-only — that was a considered and
  rejected alternative.
- **Corroboration trust gap — DOCUMENTED LIMITATION.** `canConfirmFinding`
  (Task 5) checks only the *reliability tier* of cited sources, not that a
  source's content actually supports the correction; the verification model
  self-reports `sourceRequirementsMet` and `sourceIndexes`. A
  "confirmed-with-source" finding can therefore still be a hallucinated
  correction with a real-but-irrelevant URL attached. The conservative prompt is
  the only guard. Acceptable for MVP; revisit before raising notification
  aggressiveness.
- **Cross-message dedup spam — DOCUMENTED LIMITATION.** Dedup is
  `UNIQUE(message_id, normalized_claim_key)` (Task 4). The same false claim
  repeated across N messages/users yields N findings → N immediate replies / N
  digest lines. On viral misinformation the bot will repeat the same correction.
  No cross-message throttle in MVP. Possible future: a per-chat per-claim
  cooldown window keyed on `normalized_claim_key`.
- **Cost / privacy — DOCUMENTED LIMITATION, no budget guard in MVP.** Every
  approved chat's new messages are sent to OpenAI every hour (extraction +
  per-claim web search), independent of triggers — a continuous cost and
  data-egress surface beyond the existing behavior pipeline. The only control is
  the feature flag; there is no per-run/per-day cost cap or kill switch. The
  batch caps (`maxMessagesPerBatch`, `maxClaimsPerBatch`,
  `maxSourceSearchesPerBatch`) bound a single run but not the fleet. Future work:
  a per-day run/cost cap.
- **Source snippet & reliability are weak — DOCUMENTED.** Responses-API web
  search annotations typically carry URL + title but often no usable
  `snippet`/`publisher`, while the DB requires `snippet` NOT NULL and the
  formatter shows it. The reliability heuristic (domain-substring `.gov`/`.edu`/
  media → tier) is crude, so high-stakes findings will almost always downgrade to
  `uncertain` (a lot of machinery for an "almost always uncertain" high-stakes
  path). Task 8's ctx7 doc-check MUST confirm the exact annotation shape and
  whether a snippet is retrievable; if not, fall back to an empty `snippet` or a
  short slice of `outputText` rather than failing the insert.
- **Stats timezone mismatch — DOCUMENTED.** `FACT_CHECK_TIMEZONE` is a single
  global value, but chats already carry their own `topicTimezone`
  (chat_configs). Daily/weekly/monthly stats fire on the global timezone for all
  chats. Future: per-chat stats timezone.
- **Backlog under sustained load — DOCUMENTED.** A chat producing more than
  `maxMessagesPerBatch` ready messages per hour can never be caught up by an
  hourly sweep; lag grows unbounded (no data loss — the watermark just trails).
  Acceptable for expected chat volumes.
- **"Who was wrong most" stats — PRODUCT/ETHICS NOTE.** The per-user stats
  (Task 10) are effectively a leaderboard of who made the most flagged claims.
  This is socially provocative independent of technical correctness. Flagged for
  product awareness; no change in MVP.

### Fixed in this revision (not just documented)

- **Watermark leapfrog of `pending` voice messages — FIXED.** See Task 3
  (`findReadyByChatIdAfterId` stop-at-hole query), Task 9 (hole-safe cursor note),
  Task 12 (end-to-end regression). The batch never crosses the first still-
  `pending` message; `failed` messages remain passable.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-05-fact-checker.md`.

Two execution options:

1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution: execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Choose the execution approach before implementation.
