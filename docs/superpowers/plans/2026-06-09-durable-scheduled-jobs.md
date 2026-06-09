# Durable Scheduled Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move cron scheduling out of the main `app` into a separate durable `cron-worker` backed by a SQLite `scheduled_jobs` queue, and remove the `topic-of-day` feature entirely.

**Architecture:** A new `cron-worker` process runs `node-cron` schedules plus a reconciliation loop; both write due "slots" into a `scheduled_jobs` table via `INSERT OR IGNORE`. A dispatcher claims one row at a time (guarded `UPDATE`) and calls the existing `app` HTTP job API, recording success / backoff-retry / permanent failure. `app` stops owning cron; it only executes jobs on HTTP request.

**Tech Stack:** TypeScript, Inversify DI, SQLite (`sqlite`/`sqlite3`), `node-cron`, rsbuild/rspack bundling, Vitest, Docker Compose.

**Source spec:** `docs/superpowers/specs/2026-06-08-durable-scheduled-jobs-design.md`

---

## Conventions for every task

- Tests live flat in `test/` and run with `pnpm test` (Vitest, `--config vitest.config.ts`).
- Type check: `pnpm type:check`. Lint/format auto-fix before each commit: `pnpm lint:fix && pnpm format:fix`.
- Build (verifies rspack bundling): `pnpm build`.
- Commit messages end with the project's `Co-Authored-By` trailer.
- `docs/superpowers/**` is gitignored — never `git add` it.
- No `any`, no `@ts-` directives, no default exports, prefer `null` over `undefined`, prefer pattern matching over ternaries (project `CLAUDE.md`).

## Phasing note

This plan has two independent phases that each produce working software:

- **Phase 1 — Remove `topic-of-day`** (Tasks 1–3). Smaller; lands first because it shrinks `JobName` and config that Phase 2 builds on.
- **Phase 2 — Durable scheduled jobs** (Tasks 4–14).

If you prefer, Phase 1 and Phase 2 may be executed as two separate plans. Within this document they are sequential.

## File Structure

**Phase 1 deletes:**
- `src/application/interfaces/scheduler/TopicOfDayScheduler.ts`
- `src/application/use-cases/scheduler/TopicOfDayScheduler.ts`
- `src/application/interfaces/chat/ChatConfigService.errors.ts` (only `InvalidTopicTimeError` lives here)
- `prompts/topic_of_day_system_prompt.md`
- `test/TopicOfDayScheduler.test.ts`
- `migrations/024_drop_topic_of_day_columns.{up,down}.sql` (new; drops columns)

**Phase 2 creates:**
- `src/domain/scheduler/ScheduledJobTypes.ts` — queue row + due-slot value types
- `src/domain/repositories/ScheduledJobRepository.ts` — repo interface + Symbol
- `src/infrastructure/persistence/sqlite/SQLiteScheduledJobRepository.ts` — SQLite impl
- `src/application/scheduler/CronWorkerConfig.ts` — config interface + Symbol
- `src/application/scheduler/SlotCalculator.ts` — pure slot-key computation
- `src/application/scheduler/CronSlotScheduler.ts` — interface + `DefaultCronSlotScheduler` (node-cron + reconcile)
- `src/application/scheduler/ScheduledJobDispatcher.ts` — interface + `DefaultScheduledJobDispatcher` (claim → HTTP → finish/retry/fail)
- `src/application/scheduler/CronWorker.ts` — interface + `DefaultCronWorker` (start/stop orchestrator)
- `src/container/cron-worker.ts` — `registerCronWorker`
- `src/cron-worker.ts` — process entrypoint
- `migrations/025_create_scheduled_jobs.{up,down}.sql`
- Tests: `test/SlotCalculator.test.ts`, `test/SQLiteScheduledJobRepository.test.ts`, `test/ScheduledJobDispatcher.test.ts`, `test/CronSlotScheduler.test.ts`, `test/scheduledJobsMigration025.test.ts`

**Phase 2 modifies:** `src/infrastructure/config/envSchema.ts`, `src/application/interfaces/env/EnvService.ts`, `src/infrastructure/config/DefaultEnvService.ts`, `src/infrastructure/config/TestEnvService.ts`, `src/application/fact-checking/FactCheckConfig.ts`, `src/application/behavior/BehaviorConfig.ts`, `src/application/behavior/StateEvolutionScheduler.ts`, `src/application/behavior/DefaultStateEvolutionScheduler.ts`, `src/view/telegram/MainService.ts`, `src/container/application.ts`, `rsbuild.config.ts`, `package.json`, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`. **Deletes:** `src/application/fact-checking/FactCheckScheduler.ts`, `src/application/fact-checking/DefaultFactCheckScheduler.ts`, `test/FactCheckScheduler.test.ts`.

---

# PHASE 1 — Remove topic-of-day

## Task 1: Remove topic-of-day runtime code (jobs, scheduler, AI, prompts, routes, scripts)

This is a coordinated deletion across many files. TypeScript will not compile until every reference is gone, so do all edits, then verify with `pnpm type:check` + `pnpm test`. Keep behavior-state `patch.topic` code (political topics) untouched — it is unrelated.

**Files:**
- Delete: `src/application/interfaces/scheduler/TopicOfDayScheduler.ts`
- Delete: `src/application/use-cases/scheduler/TopicOfDayScheduler.ts`
- Modify: `src/application/interfaces/scheduler/JobRunner.ts`
- Modify: `src/application/use-cases/scheduler/DefaultJobRunner.ts`
- Modify: `src/view/http/JobController.ts`
- Modify: `src/container/application.ts`
- Modify: `src/view/telegram/MainService.ts`
- Modify: `src/view/telegram/routes.ts`
- Modify: `src/application/interfaces/ai/AIService.ts`
- Modify: `src/application/use-cases/ai/DefaultContentAiService.ts`
- Modify: `src/application/prompts/PromptDirector.ts`
- Modify: `src/application/prompts/PromptBuilder.ts`
- Modify: `src/application/interfaces/env/EnvService.ts` (PromptFiles)
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`
- Delete: `prompts/topic_of_day_system_prompt.md`
- Modify: `scripts/trigger-job.mjs`
- Modify: `package.json`
- Modify: `test/integration/setup.ts` (MockAIService)
- Delete: `test/TopicOfDayScheduler.test.ts`
- Modify: any other test referencing topic-of-day (see Step 14)

- [ ] **Step 1: `JobRunner.ts` — drop `topic-of-day` from every union**

Edit `src/application/interfaces/scheduler/JobRunner.ts` so the types read exactly:

```typescript
export type JobName = 'state-evolution' | 'fact-check' | 'fact-check-stats';

export type StatsPeriod = 'daily' | 'weekly' | 'monthly';

export type JobRunInput =
  | { job: 'state-evolution'; chatId: number }
  | { job: 'fact-check'; chatId: number }
  | { job: 'fact-check-stats'; chatId: number; period: StatsPeriod };

export type JobRunResult =
  | {
      job: 'state-evolution';
      chatId: number;
      outcome: StateEvolutionRunResult['kind'];
      stateEvolution: StateEvolutionRunResult;
    }
  | {
      job: 'fact-check';
      chatId: number;
      outcome: FactCheckRunResult['outcome'];
      factCheck: FactCheckRunResult;
    }
  | {
      job: 'fact-check-stats';
      chatId: number;
      period: StatsPeriod;
      outcome: FactCheckRunResult['outcome'];
      factCheck: FactCheckRunResult;
    };

export type AllChatsJobInput =
  | { job: 'state-evolution' }
  | { job: 'fact-check' }
  | { job: 'fact-check-stats'; period: StatsPeriod };

export type AllChatsJobResult =
  | {
      job: 'fact-check' | 'fact-check-stats';
      scope: 'all';
      totalChats: number;
      results: JobRunResult[];
    }
  | { job: 'state-evolution'; scope: 'all'; outcome: 'swept' };
```

Leave the `JobRunner` interface and `JOB_RUNNER_ID` export unchanged. Keep the existing imports of `StateEvolutionRunResult` and `FactCheckRunResult`.

- [ ] **Step 2: `DefaultJobRunner.ts` — remove the scheduler dependency and topic cases**

In `src/application/use-cases/scheduler/DefaultJobRunner.ts`:
- Delete the import block for `TOPIC_OF_DAY_SCHEDULER_ID` / `TopicOfDayScheduler` (lines ~31-34).
- Delete the constructor parameter `@inject(TOPIC_OF_DAY_SCHEDULER_ID) private readonly topicOfDay: TopicOfDayScheduler,`.
- In `runForChat`, delete the entire `case 'topic-of-day':` block.
- In `runForAllChats`, delete the entire `case 'topic-of-day':` block.
- Change the `runEachApproved` signature type from `job: 'topic-of-day' | 'fact-check' | 'fact-check-stats'` to `job: 'fact-check' | 'fact-check-stats'`.

- [ ] **Step 3: `JobController.ts` — remove from `JOB_NAMES` and `dispatch`**

In `src/view/http/JobController.ts`:
- Change `JOB_NAMES` to:

```typescript
const JOB_NAMES: readonly JobName[] = [
  'state-evolution',
  'fact-check',
  'fact-check-stats',
];
```

- Delete the entire `case 'topic-of-day':` block inside `dispatch`.

- [ ] **Step 4: Delete the TopicOfDay scheduler files**

```bash
git rm src/application/interfaces/scheduler/TopicOfDayScheduler.ts \
       src/application/use-cases/scheduler/TopicOfDayScheduler.ts
```

- [ ] **Step 5: `container/application.ts` — remove the binding + imports**

In `src/container/application.ts`:
- Delete the import block `import { TOPIC_OF_DAY_SCHEDULER_ID, type TopicOfDayScheduler } from '../application/interfaces/scheduler/TopicOfDayScheduler';` (lines ~192-195).
- Delete `import { TopicOfDaySchedulerImpl } from '../application/use-cases/scheduler/TopicOfDayScheduler';` (line ~229).
- Delete the binding:

```typescript
  container
    .bind<TopicOfDayScheduler>(TOPIC_OF_DAY_SCHEDULER_ID)
    .to(TopicOfDaySchedulerImpl)
    .inSingletonScope();
```

- [ ] **Step 6: `MainService.ts` — remove the topic scheduler field, action, and menu data**

In `src/view/telegram/MainService.ts`:
- Delete the import of `TOPIC_OF_DAY_SCHEDULER_ID` / `TopicOfDayScheduler` (lines ~47-50).
- Delete the field `private readonly scheduler: TopicOfDayScheduler;` (line ~72).
- Delete the constructor param `@inject(new LazyServiceIdentifier(() => TOPIC_OF_DAY_SCHEDULER_ID)) scheduler: TopicOfDayScheduler,` (lines ~91-92).
- Delete the assignment `this.scheduler = scheduler;` (line ~105).
- Delete the `setTopicTime` action entry (lines ~138-139).
- In the `getChatData` return type, remove `topicTime: string | null;` and `topicTimezone: string;` from the `config` shape (lines ~201-202). The remaining `config` type is `{ historyLimit: number }`.
- In `launch()`, delete the line `this.scheduler.start().catch((error) => this.logger.error(error)),` from the `Promise.all([...])`. (The `factCheckScheduler` / `stateEvolutionScheduler` lines are handled in Phase 2 — leave them for now.)

> Note: `getConfig` returns a `ChatConfigEntity`; after Task 2 that entity no longer has `topicTime`/`topicTimezone`, so the `getChatData` return shape above must match. If any caller of `getChatData` reads those fields, remove those reads too (search `getChatData`).

- [ ] **Step 7: `routes.ts` — remove topic-time conversations, menu entries, and types**

In `src/view/telegram/routes.ts`:
- In the `getChatData` return type (lines ~22-26) and the `Actions` type (lines ~46-48), remove `topicTime: string | null;` and `topicTimezone: string;`.
- Remove the `setTopicTime` action from the `Actions` interface (lines ~55-59).
- Delete the `adminTopicTime` conversation function (around lines ~183-249) and the `userTopicTime` conversation function (around lines ~251-289).
- Remove `adminTopicTime` and `userTopicTime` from the object that collects conversations (lines ~292-295).
- Remove the menu handlers that call `ctx.conversation.enter('adminTopicTime')` (line ~335) and `ctx.conversation.enter('userTopicTime')` (line ~403), including their surrounding button/branch. (Search the file for `TopicTime` and the button labels near those lines; delete the inline-keyboard rows that open these conversations.)
- Remove `bot.use(createConversation(convs.adminTopicTime));` (line ~518) and `bot.use(createConversation(convs.userTopicTime));` (line ~520).

After editing, grep the file: `rg -n "[Tt]opic" src/view/telegram/routes.ts` must return nothing.

- [ ] **Step 8: `AIService.ts` + `DefaultContentAiService.ts` — remove `generateTopicOfDay`**

- In `src/application/interfaces/ai/AIService.ts`, delete the `generateTopicOfDay(params?: {...}): Promise<string>;` method from the interface.
- In `src/application/use-cases/ai/DefaultContentAiService.ts`, delete the entire `public async generateTopicOfDay(...)` method (lines ~46-90). Remove any now-unused imports flagged by `pnpm type:check`.

- [ ] **Step 9: Prompts — remove topic-of-day builder/director methods and the file**

- In `src/application/prompts/PromptDirector.ts`, delete `createTopicOfDayPrompt(...)` (lines ~40-49).
- In `src/application/prompts/PromptBuilder.ts`, delete `addTopicOfDaySystem(...)` (lines ~136-end of that method).
- In `src/application/interfaces/env/EnvService.ts` `PromptFiles`, delete `topicOfDaySystem: string;` (line ~48).
- In `src/infrastructure/config/DefaultEnvService.ts` and `src/infrastructure/config/TestEnvService.ts`, delete the `topicOfDaySystem: 'prompts/topic_of_day_system_prompt.md',` line from `getPromptFiles()`.
- Delete the prompt file:

```bash
git rm prompts/topic_of_day_system_prompt.md
```

- [ ] **Step 10: `scripts/trigger-job.mjs` + `package.json` — remove topic-of-day**

- In `scripts/trigger-job.mjs`, change `const JOBS = ['topic-of-day', 'state-evolution', 'fact-check', 'fact-check-stats'];` to:

```javascript
const JOBS = ['state-evolution', 'fact-check', 'fact-check-stats'];
```

- In `package.json`, delete the two scripts `"job:topic-of-day"` and `"job:topic-of-day:all"`.

- [ ] **Step 11: `test/integration/setup.ts` — drop `generateTopicOfDay` from the mock**

In `test/integration/setup.ts`, the `MockAIService` implements `AIService`. Delete the method:

```typescript
  async generateTopicOfDay(): Promise<string> {
    return '';
  }
```

- [ ] **Step 12: Delete the topic-of-day test**

```bash
git rm test/TopicOfDayScheduler.test.ts
```

- [ ] **Step 13: Type-check, then fix remaining topic references in tests**

Run: `pnpm type:check`
Expected: compile errors only in test files still referencing topic-of-day (e.g. `test/JobController.test.ts`, `test/JobRunner.test.ts`, `test/PromptDirector.test.ts`, `test/PromptBuilder.test.ts`, `test/MainService.test.ts`, `test/EnvService.test.ts`, `test/triggerJobArgs.test.ts`, `test/DefaultContentAiService.test.ts`).

For each failing test file: delete the `topic-of-day` / `generateTopicOfDay` / `topicOfDaySystem` cases and assertions. Do not weaken unrelated assertions. Re-run `pnpm type:check` until clean.

- [ ] **Step 14: Run the full suite**

Run: `pnpm test`
Expected: PASS (topic-of-day specs gone; everything else green).

If `RepositoryChatConfigService.test.ts` fails, that is expected — it is fully addressed in Task 2. If it blocks here, temporarily skip it with `it.skip` and a `// TODO(Task 2)` note, then unskip in Task 2.

- [ ] **Step 15: Commit**

```bash
pnpm lint:fix && pnpm format:fix && pnpm build
git add -A
git commit -m "refactor: remove topic-of-day runtime feature"
```

---

## Task 2: Remove topic-of-day from chat config (entity, repository, service)

**Files:**
- Modify: `src/domain/entities/ChatConfigEntity.ts`
- Modify: `src/application/interfaces/chat/ChatConfigService.ts`
- Delete: `src/application/interfaces/chat/ChatConfigService.errors.ts`
- Modify: `src/application/use-cases/chat/RepositoryChatConfigService.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteChatConfigRepository.ts`
- Modify: `src/domain/repositories/ChatConfigRepository.ts` (entity-shaped methods)
- Test: `test/RepositoryChatConfigService.test.ts`

- [ ] **Step 1: Update the failing test first**

In `test/RepositoryChatConfigService.test.ts`, remove every assertion and helper referencing `topicTime`, `topicTimezone`, `setTopicTime`, `getTopicOfDaySchedules`, or `InvalidTopicTimeError`. Keep `getConfig` / `setHistoryLimit` tests. A `getConfig` default should now assert exactly:

```typescript
expect(config).toEqual({ chatId, historyLimit: DEFAULT_HISTORY_LIMIT });
```

(Use the same default value the service already uses for `historyLimit`.)

- [ ] **Step 2: `ChatConfigEntity.ts` — keep only used fields**

Replace `src/domain/entities/ChatConfigEntity.ts` with:

```typescript
export interface ChatConfigEntity {
  chatId: number;
  historyLimit: number;
}
```

- [ ] **Step 3: `ChatConfigService.ts` — remove topic methods**

Replace the interface body in `src/application/interfaces/chat/ChatConfigService.ts` with:

```typescript
export interface ChatConfigService {
  getConfig(chatId: number): Promise<ChatConfigEntity>;
  setHistoryLimit(chatId: number, historyLimit: number): Promise<void>;
}
```

Then delete the now-unused errors file:

```bash
git rm src/application/interfaces/chat/ChatConfigService.errors.ts
```

(If anything other than the topic flow imports from that file, `pnpm type:check` will flag it — there should be nothing.)

- [ ] **Step 4: `RepositoryChatConfigService.ts` — remove topic logic**

In `src/application/use-cases/chat/RepositoryChatConfigService.ts`:
- Delete the import of `InvalidTopicTimeError`.
- Delete the constants `DEFAULT_TOPIC_TIME`, `DEFAULT_TOPIC_TIMEZONE`, `TOPIC_TIME_REGEX`.
- In `getConfig`'s default object, remove `topicTime` / `topicTimezone` so it returns `{ chatId, historyLimit: <existing default> }`.
- Delete the `getTopicOfDaySchedules()` method entirely.
- Delete the `setTopicTime(...)` method entirely.
- Anywhere an upsert spreads `{ ...config, topicTime, topicTimezone }`, change it to upsert just `{ chatId, historyLimit }`.

- [ ] **Step 5: `ChatConfigRepository.ts` — match the trimmed entity**

Open `src/domain/repositories/ChatConfigRepository.ts`. If `upsert` / return types reference `topicTime` / `topicTimezone` via `ChatConfigEntity`, they update automatically. If the interface names those fields explicitly, remove them so the repo contract is `{ chatId, historyLimit }`.

- [ ] **Step 6: `SQLiteChatConfigRepository.ts` — stop reading/writing topic columns**

In `src/infrastructure/persistence/sqlite/SQLiteChatConfigRepository.ts`:
- In `upsert`, change the SQL to:

```typescript
'INSERT INTO chat_configs (chat_id, history_limit) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET history_limit=excluded.history_limit'
```

and pass only `chatId, historyLimit` (remove `topicTime`, `topicTimezone` params and destructuring).
- In the single-row read, change the SQL to `SELECT chat_id, history_limit FROM chat_configs WHERE chat_id = ?` and map only `{ chatId: row.chat_id, historyLimit: row.history_limit }`. Remove the `topic_time` / `topic_timezone` fields from the row type and mapping.
- In the all-rows read, change to `SELECT chat_id, history_limit FROM chat_configs` and map only `{ chatId, historyLimit }`.

> The DB columns still physically exist after this step; the repo simply stops selecting them. The migration in Task 3 drops them.

- [ ] **Step 7: Type-check, test, commit**

Run: `pnpm type:check` → Expected: PASS
Run: `pnpm test` → Expected: PASS (unskip any `it.skip` left in Task 1 Step 14)

```bash
pnpm lint:fix && pnpm format:fix && pnpm build
git add -A
git commit -m "refactor: drop topic fields from chat config"
```

---

## Task 3: Migration 024 — drop topic columns

**Files:**
- Create: `migrations/024_drop_topic_of_day_columns.up.sql`
- Create: `migrations/024_drop_topic_of_day_columns.down.sql`
- Create: `test/topicColumnsMigration024.test.ts`

- [ ] **Step 1: Write the migration test (failing)**

Create `test/topicColumnsMigration024.test.ts`:

```typescript
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 024 drop topic-of-day columns', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('removes topic_time and topic_timezone from chat_configs', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'drop-topic-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const columns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(chat_configs)'
    );
    await db.close();

    const names = columns.map((c) => c.name);
    expect(names).toContain('chat_id');
    expect(names).toContain('history_limit');
    expect(names).not.toContain('topic_time');
    expect(names).not.toContain('topic_timezone');
  });
});
```

- [ ] **Step 2: Run it (fails — columns still present)**

Run: `pnpm test -- topicColumnsMigration024`
Expected: FAIL (`topic_time` still in `chat_configs`).

- [ ] **Step 3: Write the up migration**

Create `migrations/024_drop_topic_of_day_columns.up.sql`:

```sql
BEGIN TRANSACTION;

ALTER TABLE chat_configs DROP COLUMN topic_time;
ALTER TABLE chat_configs DROP COLUMN topic_timezone;

COMMIT;
```

- [ ] **Step 4: Write the down migration**

Create `migrations/024_drop_topic_of_day_columns.down.sql`:

```sql
BEGIN TRANSACTION;

ALTER TABLE chat_configs ADD COLUMN topic_time TEXT DEFAULT NULL;
ALTER TABLE chat_configs ADD COLUMN topic_timezone TEXT NOT NULL DEFAULT 'UTC';

COMMIT;
```

- [ ] **Step 5: Run the test (passes)**

Run: `pnpm test -- topicColumnsMigration024`
Expected: PASS

- [ ] **Step 6: Full suite + commit**

Run: `pnpm test` → Expected: PASS

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: migration to drop topic-of-day columns"
```

---

# PHASE 2 — Durable scheduled jobs

## Task 4: Migration 025 — create `scheduled_jobs`

**Files:**
- Create: `migrations/025_create_scheduled_jobs.up.sql`
- Create: `migrations/025_create_scheduled_jobs.down.sql`
- Create: `test/scheduledJobsMigration025.test.ts`

- [ ] **Step 1: Write the migration test (failing)**

Create `test/scheduledJobsMigration025.test.ts`:

```typescript
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 025 scheduled_jobs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('creates scheduled_jobs with all columns and a unique slot constraint', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'scheduled-jobs-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const columns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(scheduled_jobs)'
    );

    // unique (job_name, slot_key): a duplicate insert must throw.
    await db.run(
      `INSERT INTO scheduled_jobs
        (job_name, slot_key, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at)
       VALUES ('fact-check', 'fact-check:2026-06-08T14', '{}', 'pending', 0, 5, ?, ?, ?)`,
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:00:00.000Z'
    );
    let duplicateRejected = false;
    try {
      await db.run(
        `INSERT INTO scheduled_jobs
          (job_name, slot_key, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at)
         VALUES ('fact-check', 'fact-check:2026-06-08T14', '{}', 'pending', 0, 5, ?, ?, ?)`,
        '2026-06-08T14:00:00.000Z',
        '2026-06-08T14:00:00.000Z',
        '2026-06-08T14:00:00.000Z'
      );
    } catch {
      duplicateRejected = true;
    }
    await db.close();

    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'job_name',
        'slot_key',
        'payload_json',
        'status',
        'attempts',
        'max_attempts',
        'run_after',
        'locked_until',
        'last_error',
        'created_at',
        'updated_at',
        'finished_at',
      ])
    );
    expect(duplicateRejected).toBe(true);
  });
});
```

- [ ] **Step 2: Run it (fails — no table)**

Run: `pnpm test -- scheduledJobsMigration025`
Expected: FAIL (`no such table: scheduled_jobs`).

- [ ] **Step 3: Write the up migration**

Create `migrations/025_create_scheduled_jobs.up.sql`:

```sql
BEGIN TRANSACTION;

CREATE TABLE scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  slot_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_after TEXT NOT NULL,
  locked_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(job_name, slot_key)
);

CREATE INDEX idx_scheduled_jobs_due
  ON scheduled_jobs(status, run_after, locked_until);

COMMIT;
```

- [ ] **Step 4: Write the down migration**

Create `migrations/025_create_scheduled_jobs.down.sql`:

```sql
BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_scheduled_jobs_due;
DROP TABLE IF EXISTS scheduled_jobs;

COMMIT;
```

- [ ] **Step 5: Run the test (passes)**

Run: `pnpm test -- scheduledJobsMigration025`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: migration to create scheduled_jobs queue table"
```

---

## Task 5: Domain types + repository interface for scheduled jobs

**Files:**
- Create: `src/domain/scheduler/ScheduledJobTypes.ts`
- Create: `src/domain/repositories/ScheduledJobRepository.ts`

- [ ] **Step 1: Create the value types**

Create `src/domain/scheduler/ScheduledJobTypes.ts`:

```typescript
export type ScheduledJobName =
  | 'state-evolution'
  | 'fact-check'
  | 'fact-check-stats';

export type ScheduledJobStatus =
  | 'pending'
  | 'running'
  | 'retry_scheduled'
  | 'succeeded'
  | 'failed';

export interface ScheduledJob {
  id: number;
  jobName: ScheduledJobName;
  slotKey: string;
  payloadJson: string;
  status: ScheduledJobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface DueSlot {
  jobName: ScheduledJobName;
  slotKey: string;
  payloadJson: string;
  runAfter: string;
}
```

- [ ] **Step 2: Create the repository interface**

Create `src/domain/repositories/ScheduledJobRepository.ts`:

```typescript
import type { ServiceIdentifier } from 'inversify';

import type {
  DueSlot,
  ScheduledJob,
  ScheduledJobName,
} from '@/domain/scheduler/ScheduledJobTypes';

export interface ScheduledJobRepository {
  /** Idempotent INSERT OR IGNORE keyed on (job_name, slot_key). */
  insertDueSlot(slot: DueSlot, maxAttempts: number, now: string): Promise<void>;
  /** Atomically claim one due row (pending / due retry / stale running). */
  claimNext(now: string, lockedUntil: string): Promise<ScheduledJob | null>;
  markSucceeded(id: number, now: string): Promise<void>;
  scheduleRetry(
    id: number,
    runAfter: string,
    lastError: string,
    now: string
  ): Promise<void>;
  markFailed(id: number, lastError: string, now: string): Promise<void>;
  findBySlot(
    jobName: ScheduledJobName,
    slotKey: string
  ): Promise<ScheduledJob | null>;
}

export const SCHEDULED_JOB_REPOSITORY_ID = Symbol.for(
  'ScheduledJobRepository'
) as ServiceIdentifier<ScheduledJobRepository>;
```

- [ ] **Step 3: Type-check + commit**

Run: `pnpm type:check` → Expected: PASS

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: scheduled job domain types and repository interface"
```

---

## Task 6: SQLite scheduled-job repository

**Files:**
- Create: `src/infrastructure/persistence/sqlite/SQLiteScheduledJobRepository.ts`
- Test: `test/SQLiteScheduledJobRepository.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/SQLiteScheduledJobRepository.test.ts`:

```typescript
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteScheduledJobRepository } from '../src/infrastructure/persistence/sqlite/SQLiteScheduledJobRepository';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { DueSlot } from '../src/domain/scheduler/ScheduledJobTypes';

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

const slot = (overrides: Partial<DueSlot> = {}): DueSlot => ({
  jobName: 'fact-check',
  slotKey: 'fact-check:2026-06-08T14',
  payloadJson: '{}',
  runAfter: '2026-06-08T14:00:00.000Z',
  ...overrides,
});

describe('SQLiteScheduledJobRepository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  async function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), 'scheduled-job-repo-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const env = new TestEnvService();
    const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
    const repo = new SQLiteScheduledJobRepository(provider);
    return { repo };
  }

  it('insertDueSlot is idempotent on (job_name, slot_key)', async () => {
    const { repo } = await setup();
    const now = '2026-06-08T14:00:00.000Z';

    await repo.insertDueSlot(slot(), 5, now);
    await repo.insertDueSlot(slot(), 5, now);

    const found = await repo.findBySlot('fact-check', 'fact-check:2026-06-08T14');
    expect(found).not.toBeNull();
    expect(found?.status).toBe('pending');
    expect(found?.attempts).toBe(0);
  });

  it('claimNext claims a pending row and increments attempts', async () => {
    const { repo } = await setup();
    const now = '2026-06-08T14:00:00.000Z';
    const lockedUntil = '2026-06-08T14:10:00.000Z';

    await repo.insertDueSlot(slot(), 5, now);
    const claimed = await repo.claimNext(now, lockedUntil);

    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.lockedUntil).toBe(lockedUntil);
  });

  it('claimNext returns null when nothing is due', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(
      slot({ runAfter: '2026-06-08T20:00:00.000Z' }),
      5,
      '2026-06-08T14:00:00.000Z'
    );
    const claimed = await repo.claimNext(
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:10:00.000Z'
    );
    expect(claimed).toBeNull();
  });

  it('claimNext does not double-claim the same row', async () => {
    const { repo } = await setup();
    const now = '2026-06-08T14:00:00.000Z';
    const lockedUntil = '2026-06-08T14:10:00.000Z';

    await repo.insertDueSlot(slot(), 5, now);
    const first = await repo.claimNext(now, lockedUntil);
    const second = await repo.claimNext(now, lockedUntil);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('claimNext reclaims a stale running row after locked_until', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(slot(), 5, '2026-06-08T14:00:00.000Z');

    const staleLock = '2026-06-08T14:01:00.000Z';
    const first = await repo.claimNext('2026-06-08T14:00:00.000Z', staleLock);
    expect(first?.attempts).toBe(1);

    const later = '2026-06-08T14:05:00.000Z';
    const newLock = '2026-06-08T14:15:00.000Z';
    const second = await repo.claimNext(later, newLock);
    expect(second?.attempts).toBe(2);
    expect(second?.lockedUntil).toBe(newLock);
  });

  it('scheduleRetry makes the row due again at run_after', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(slot(), 5, '2026-06-08T14:00:00.000Z');
    const claimed = await repo.claimNext(
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:10:00.000Z'
    );

    await repo.scheduleRetry(
      claimed!.id,
      '2026-06-08T14:30:00.000Z',
      'HTTP 500',
      '2026-06-08T14:00:30.000Z'
    );

    const stillTooEarly = await repo.claimNext(
      '2026-06-08T14:20:00.000Z',
      '2026-06-08T14:40:00.000Z'
    );
    expect(stillTooEarly).toBeNull();

    const dueNow = await repo.claimNext(
      '2026-06-08T14:31:00.000Z',
      '2026-06-08T14:41:00.000Z'
    );
    expect(dueNow?.status).toBe('running');
    expect(dueNow?.attempts).toBe(2);
    expect(dueNow?.lastError).toBe('HTTP 500');
  });

  it('markSucceeded sets terminal state and clears lock/error', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(slot(), 5, '2026-06-08T14:00:00.000Z');
    const claimed = await repo.claimNext(
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:10:00.000Z'
    );

    await repo.markSucceeded(claimed!.id, '2026-06-08T14:02:00.000Z');

    const found = await repo.findBySlot(
      'fact-check',
      'fact-check:2026-06-08T14'
    );
    expect(found?.status).toBe('succeeded');
    expect(found?.finishedAt).toBe('2026-06-08T14:02:00.000Z');
    expect(found?.lockedUntil).toBeNull();
    expect(found?.lastError).toBeNull();
  });

  it('markFailed sets terminal failed state with last_error', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(slot(), 5, '2026-06-08T14:00:00.000Z');
    const claimed = await repo.claimNext(
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:10:00.000Z'
    );

    await repo.markFailed(claimed!.id, 'boom', '2026-06-08T14:03:00.000Z');

    const found = await repo.findBySlot(
      'fact-check',
      'fact-check:2026-06-08T14'
    );
    expect(found?.status).toBe('failed');
    expect(found?.finishedAt).toBe('2026-06-08T14:03:00.000Z');
    expect(found?.lastError).toBe('boom');
    expect(found?.lockedUntil).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests (fail — module missing)**

Run: `pnpm test -- SQLiteScheduledJobRepository`
Expected: FAIL (cannot find `SQLiteScheduledJobRepository`).

- [ ] **Step 3: Implement the repository**

Create `src/infrastructure/persistence/sqlite/SQLiteScheduledJobRepository.ts`:

```typescript
import { inject, injectable } from 'inversify';

import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { ScheduledJobRepository } from '@/domain/repositories/ScheduledJobRepository';
import type {
  DueSlot,
  ScheduledJob,
  ScheduledJobName,
  ScheduledJobStatus,
} from '@/domain/scheduler/ScheduledJobTypes';

interface ScheduledJobRow {
  id: number;
  job_name: ScheduledJobName;
  slot_key: string;
  payload_json: string;
  status: ScheduledJobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

const DUE_PREDICATE = `(
  status = 'pending'
  OR (status = 'retry_scheduled' AND run_after <= ?)
  OR (status = 'running' AND locked_until IS NOT NULL AND locked_until <= ?)
)`;

function rowToJob(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    jobName: row.job_name,
    slotKey: row.slot_key,
    payloadJson: row.payload_json,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lockedUntil: row.locked_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

@injectable()
export class SQLiteScheduledJobRepository implements ScheduledJobRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async insertDueSlot(
    slot: DueSlot,
    maxAttempts: number,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT OR IGNORE INTO scheduled_jobs
        (job_name, slot_key, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
      slot.jobName,
      slot.slotKey,
      slot.payloadJson,
      maxAttempts,
      slot.runAfter,
      now,
      now
    );
  }

  async claimNext(
    now: string,
    lockedUntil: string
  ): Promise<ScheduledJob | null> {
    const db = await this.dbProvider.get();

    await db.run('BEGIN IMMEDIATE');
    try {
      const row = await db.get<ScheduledJobRow>(
        `SELECT * FROM scheduled_jobs
         WHERE ${DUE_PREDICATE}
         ORDER BY run_after ASC, id ASC
         LIMIT 1`,
        now,
        now
      );

      if (!row) {
        await db.run('COMMIT');
        return null;
      }

      const result = (await db.run(
        `UPDATE scheduled_jobs
         SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = ?
         WHERE id = ? AND ${DUE_PREDICATE}`,
        lockedUntil,
        now,
        row.id,
        now,
        now
      )) as { changes?: number };

      await db.run('COMMIT');

      if (result.changes !== 1) {
        return null;
      }

      return rowToJob({
        ...row,
        status: 'running',
        attempts: row.attempts + 1,
        locked_until: lockedUntil,
        updated_at: now,
      });
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }

  async markSucceeded(id: number, now: string): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE scheduled_jobs
       SET status = 'succeeded', finished_at = ?, locked_until = NULL, last_error = NULL, updated_at = ?
       WHERE id = ?`,
      now,
      now,
      id
    );
  }

  async scheduleRetry(
    id: number,
    runAfter: string,
    lastError: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE scheduled_jobs
       SET status = 'retry_scheduled', run_after = ?, locked_until = NULL, last_error = ?, updated_at = ?
       WHERE id = ?`,
      runAfter,
      lastError,
      now,
      id
    );
  }

  async markFailed(id: number, lastError: string, now: string): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE scheduled_jobs
       SET status = 'failed', finished_at = ?, locked_until = NULL, last_error = ?, updated_at = ?
       WHERE id = ?`,
      now,
      lastError,
      now,
      id
    );
  }

  async findBySlot(
    jobName: ScheduledJobName,
    slotKey: string
  ): Promise<ScheduledJob | null> {
    const db = await this.dbProvider.get();
    const row = await db.get<ScheduledJobRow>(
      'SELECT * FROM scheduled_jobs WHERE job_name = ? AND slot_key = ?',
      jobName,
      slotKey
    );
    return row ? rowToJob(row) : null;
  }
}
```

- [ ] **Step 4: Run tests (pass)**

Run: `pnpm test -- SQLiteScheduledJobRepository`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: SQLite scheduled job repository"
```

---

## Task 7: SlotCalculator (pure slot-key computation)

**Files:**
- Create: `src/application/scheduler/SlotCalculator.ts`
- Test: `test/SlotCalculator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/SlotCalculator.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { SlotCalculator } from '../src/application/scheduler/SlotCalculator';

// Fixed instant: 2026-06-08T14:30:00Z. In UTC the civil hour is 14.
const at = (iso: string) => new Date(iso);

describe('SlotCalculator (UTC)', () => {
  const calc = new SlotCalculator('UTC');

  it('hourly fact-check slot buckets by civil hour', () => {
    const slot = calc.hourlyFactCheck(at('2026-06-08T14:30:00.000Z'));
    expect(slot.jobName).toBe('fact-check');
    expect(slot.slotKey).toBe('fact-check:2026-06-08T14');
    expect(slot.payloadJson).toBe('{}');
    expect(slot.runAfter).toBe('2026-06-08T14:30:00.000Z');
  });

  it('state-evolution slot buckets by civil hour', () => {
    const slot = calc.stateEvolution(at('2026-06-08T14:30:00.000Z'));
    expect(slot.jobName).toBe('state-evolution');
    expect(slot.slotKey).toBe('state-evolution:2026-06-08T14');
    expect(slot.payloadJson).toBe('{}');
  });

  it('daily stats slot buckets by civil day with period payload', () => {
    const slot = calc.dailyStats(at('2026-06-08T14:30:00.000Z'));
    expect(slot.jobName).toBe('fact-check-stats');
    expect(slot.slotKey).toBe('fact-check-stats:daily:2026-06-08');
    expect(slot.payloadJson).toBe('{"period":"daily"}');
  });

  it('weekly stats slot uses ISO week', () => {
    // 2026-06-08 is a Monday in ISO week 24 of 2026.
    const slot = calc.weeklyStats(at('2026-06-08T14:30:00.000Z'));
    expect(slot.slotKey).toBe('fact-check-stats:weekly:2026-W24');
    expect(slot.payloadJson).toBe('{"period":"weekly"}');
  });

  it('monthly stats slot buckets by civil month', () => {
    const slot = calc.monthlyStats(at('2026-06-08T14:30:00.000Z'));
    expect(slot.slotKey).toBe('fact-check-stats:monthly:2026-06');
    expect(slot.payloadJson).toBe('{"period":"monthly"}');
  });
});

describe('SlotCalculator (timezone-aware)', () => {
  // 2026-06-08T23:30:00Z is 2026-06-09 01:30 in Europe/Warsaw (UTC+2 DST).
  const calc = new SlotCalculator('Europe/Warsaw');

  it('computes the civil day in the configured timezone, not UTC', () => {
    const slot = calc.dailyStats(at('2026-06-08T23:30:00.000Z'));
    expect(slot.slotKey).toBe('fact-check-stats:daily:2026-06-09');
  });

  it('computes the civil hour in the configured timezone', () => {
    const slot = calc.hourlyFactCheck(at('2026-06-08T23:30:00.000Z'));
    expect(slot.slotKey).toBe('fact-check:2026-06-09T01');
  });
});
```

- [ ] **Step 2: Run tests (fail — module missing)**

Run: `pnpm test -- SlotCalculator`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement SlotCalculator**

Create `src/application/scheduler/SlotCalculator.ts`:

```typescript
import type { DueSlot } from '@/domain/scheduler/ScheduledJobTypes';

interface CivilParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function pad4(value: number): string {
  return value.toString().padStart(4, '0');
}

/** Civil date-time parts in the given IANA timezone. */
function partsInZone(date: Date, timeZone: string): CivilParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const lookup = new Map(
    fmt.formatToParts(date).map((part) => [part.type, part.value])
  );
  const rawHour = lookup.get('hour') ?? '0';
  return {
    year: Number(lookup.get('year')),
    month: Number(lookup.get('month')),
    day: Number(lookup.get('day')),
    // Intl can emit '24' for midnight in some environments; normalize to 0.
    hour: rawHour === '24' ? 0 : Number(rawHour),
  };
}

/** ISO-8601 week number and ISO week-year for a civil date. */
function isoWeek(p: CivilParts): { isoYear: number; week: number } {
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // move to Thursday of this week
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const week =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / msPerWeek);
  return { isoYear, week };
}

export class SlotCalculator {
  constructor(private readonly timezone: string) {}

  private hourBucket(date: Date): string {
    const p = partsInZone(date, this.timezone);
    return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}`;
  }

  hourlyFactCheck(date: Date): DueSlot {
    return {
      jobName: 'fact-check',
      slotKey: `fact-check:${this.hourBucket(date)}`,
      payloadJson: '{}',
      runAfter: date.toISOString(),
    };
  }

  stateEvolution(date: Date): DueSlot {
    return {
      jobName: 'state-evolution',
      slotKey: `state-evolution:${this.hourBucket(date)}`,
      payloadJson: '{}',
      runAfter: date.toISOString(),
    };
  }

  dailyStats(date: Date): DueSlot {
    const p = partsInZone(date, this.timezone);
    const day = `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
    return {
      jobName: 'fact-check-stats',
      slotKey: `fact-check-stats:daily:${day}`,
      payloadJson: '{"period":"daily"}',
      runAfter: date.toISOString(),
    };
  }

  weeklyStats(date: Date): DueSlot {
    const { isoYear, week } = isoWeek(partsInZone(date, this.timezone));
    return {
      jobName: 'fact-check-stats',
      slotKey: `fact-check-stats:weekly:${pad4(isoYear)}-W${pad2(week)}`,
      payloadJson: '{"period":"weekly"}',
      runAfter: date.toISOString(),
    };
  }

  monthlyStats(date: Date): DueSlot {
    const p = partsInZone(date, this.timezone);
    return {
      jobName: 'fact-check-stats',
      slotKey: `fact-check-stats:monthly:${pad4(p.year)}-${pad2(p.month)}`,
      payloadJson: '{"period":"monthly"}',
      runAfter: date.toISOString(),
    };
  }
}
```

- [ ] **Step 4: Run tests (pass)**

Run: `pnpm test -- SlotCalculator`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: slot calculator for scheduled job slot keys"
```

---

## Task 8: CronWorkerConfig + env wiring

This task is **purely additive** — it introduces the worker config and new env vars, and a new `STATE_EVOLUTION_SWEEP_CRON` env (which supersedes the old hardcoded `sweepCron`). `getCronWorkerConfig` reads the existing `FACT_CHECK_*_CRON` / `FACT_CHECK_TIMEZONE` env values. The actual **relocation** (removing the now-duplicated cron fields from `FactCheckConfig`/`StateEvolutionConfig`) happens in Task 13, together with deleting the scheduler classes that read them, so the tree stays green at every commit.

**Files:**
- Create: `src/application/scheduler/CronWorkerConfig.ts`
- Modify: `src/infrastructure/config/envSchema.ts`
- Modify: `src/application/interfaces/env/EnvService.ts`
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`
- Modify: `.env.example`
- Test: `test/CronWorkerConfig.test.ts`

- [ ] **Step 1: Create the config interface**

Create `src/application/scheduler/CronWorkerConfig.ts`:

```typescript
import type { ServiceIdentifier } from 'inversify';

export interface CronWorkerConfig {
  jobsBaseUrl: string;
  hourlyCron: string;
  dailyStatsCron: string;
  weeklyStatsCron: string;
  monthlyStatsCron: string;
  sweepCron: string;
  timezone: string;
  pollIntervalMs: number;
  reconcileIntervalMs: number;
  lockMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  jobRequestTimeoutMs: number;
}

export const CRON_WORKER_CONFIG_ID = Symbol.for(
  'CronWorkerConfig'
) as ServiceIdentifier<CronWorkerConfig>;
```

- [ ] **Step 2: Write the config test (failing)**

Create `test/CronWorkerConfig.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DefaultEnvService } from '../src/infrastructure/config/DefaultEnvService';

const BASE_ENV = {
  BOT_TOKEN: 'x',
  OPENAI_KEY: 'x',
  DATABASE_URL: 'file:///tmp/x.db',
  ADMIN_CHAT_ID: '0',
};

describe('getCronWorkerConfig', () => {
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    process.env = { ...BASE_ENV } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = saved;
  });

  it('exposes scheduler defaults and reused cron expressions', () => {
    const config = new DefaultEnvService().getCronWorkerConfig();
    expect(config.jobsBaseUrl).toBe('http://localhost:3000');
    expect(config.hourlyCron).toBe('0 0 * * * *');
    expect(config.sweepCron).toBe('0 */3 * * *');
    expect(config.timezone).toBe('Europe/Warsaw');
    expect(config.maxAttempts).toBe(5);
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.reconcileIntervalMs).toBe(60000);
    expect(config.lockMs).toBe(600000);
    expect(config.backoffBaseMs).toBe(30000);
    expect(config.jobRequestTimeoutMs).toBe(600000);
  });

  it('overrides from env', () => {
    process.env.JOBS_BASE_URL = 'http://app:3000';
    process.env.SCHEDULER_MAX_ATTEMPTS = '7';
    const config = new DefaultEnvService().getCronWorkerConfig();
    expect(config.jobsBaseUrl).toBe('http://app:3000');
    expect(config.maxAttempts).toBe(7);
  });
});
```

Run: `pnpm test -- CronWorkerConfig` → Expected: FAIL (`getCronWorkerConfig` is not a function).

- [ ] **Step 3: Extend `envSchema.ts`**

In `src/infrastructure/config/envSchema.ts`, add these keys inside the `z.object({ ... })` (after the `FACT_CHECK_*` block, before the closing `})`):

```typescript
    JOBS_BASE_URL: z.string().min(1).default('http://localhost:3000'),
    STATE_EVOLUTION_SWEEP_CRON: z.string().min(1).default('0 */3 * * *'),
    SCHEDULER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    SCHEDULER_RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60000),
    SCHEDULER_LOCK_MS: z.coerce.number().int().positive().default(600000),
    SCHEDULER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    SCHEDULER_BACKOFF_BASE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30000),
    SCHEDULER_JOB_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(600000),
```

- [ ] **Step 4: Extend the `Env` interface**

In `src/application/interfaces/env/EnvService.ts`, add to `interface Env` (after the `FACT_CHECK_*` fields):

```typescript
  JOBS_BASE_URL: string;
  STATE_EVOLUTION_SWEEP_CRON: string;
  SCHEDULER_POLL_INTERVAL_MS: number;
  SCHEDULER_RECONCILE_INTERVAL_MS: number;
  SCHEDULER_LOCK_MS: number;
  SCHEDULER_MAX_ATTEMPTS: number;
  SCHEDULER_BACKOFF_BASE_MS: number;
  SCHEDULER_JOB_REQUEST_TIMEOUT_MS: number;
```

Also add `getCronWorkerConfig(): CronWorkerConfig;` to the `EnvService` interface, and add the import:

```typescript
import type { CronWorkerConfig } from '@/application/scheduler/CronWorkerConfig';
```

- [ ] **Step 5: Implement `getCronWorkerConfig` in both env services**

Add this method to **both** `src/infrastructure/config/DefaultEnvService.ts` and `src/infrastructure/config/TestEnvService.ts` (and import the type at the top: `import type { CronWorkerConfig } from '@/application/scheduler/CronWorkerConfig';`):

```typescript
  getCronWorkerConfig(): CronWorkerConfig {
    return {
      jobsBaseUrl: this.env.JOBS_BASE_URL,
      hourlyCron: this.env.FACT_CHECK_HOURLY_CRON,
      dailyStatsCron: this.env.FACT_CHECK_DAILY_STATS_CRON,
      weeklyStatsCron: this.env.FACT_CHECK_WEEKLY_STATS_CRON,
      monthlyStatsCron: this.env.FACT_CHECK_MONTHLY_STATS_CRON,
      sweepCron: this.env.STATE_EVOLUTION_SWEEP_CRON,
      timezone: this.env.FACT_CHECK_TIMEZONE,
      pollIntervalMs: this.env.SCHEDULER_POLL_INTERVAL_MS,
      reconcileIntervalMs: this.env.SCHEDULER_RECONCILE_INTERVAL_MS,
      lockMs: this.env.SCHEDULER_LOCK_MS,
      maxAttempts: this.env.SCHEDULER_MAX_ATTEMPTS,
      backoffBaseMs: this.env.SCHEDULER_BACKOFF_BASE_MS,
      jobRequestTimeoutMs: this.env.SCHEDULER_JOB_REQUEST_TIMEOUT_MS,
    };
  }
```

- [ ] **Step 6: Update `.env.example`**

Add a documented block to `.env.example`:

```dotenv
# --- cron-worker (durable scheduled jobs) ---
JOBS_BASE_URL=http://localhost:3000
STATE_EVOLUTION_SWEEP_CRON=0 */3 * * *
SCHEDULER_POLL_INTERVAL_MS=5000
SCHEDULER_RECONCILE_INTERVAL_MS=60000
SCHEDULER_LOCK_MS=600000
SCHEDULER_MAX_ATTEMPTS=5
SCHEDULER_BACKOFF_BASE_MS=30000
SCHEDULER_JOB_REQUEST_TIMEOUT_MS=600000
```

- [ ] **Step 7: Type-check + run config test**

Run: `pnpm type:check` → Expected: PASS (this task is additive; `FactCheckConfig`/`StateEvolutionConfig` still carry their cron fields, so nothing breaks).
Run: `pnpm test -- CronWorkerConfig` → Expected: PASS

- [ ] **Step 8: Commit**

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: add CronWorkerConfig and scheduler env wiring"
```

---

## Task 9: ScheduledJobDispatcher

**Files:**
- Create: `src/application/scheduler/ScheduledJobDispatcher.ts`
- Test: `test/ScheduledJobDispatcher.test.ts`

The dispatcher claims due rows one at a time, maps each to an `app` HTTP endpoint, and records the outcome. On permanent failure it emits a structured error log.

- [ ] **Step 1: Write failing tests**

Create `test/ScheduledJobDispatcher.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DefaultScheduledJobDispatcher } from '../src/application/scheduler/ScheduledJobDispatcher';
import type { CronWorkerConfig } from '../src/application/scheduler/CronWorkerConfig';
import type { ScheduledJobRepository } from '../src/domain/repositories/ScheduledJobRepository';
import type {
  ScheduledJob,
  ScheduledJobName,
} from '../src/domain/scheduler/ScheduledJobTypes';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const config: CronWorkerConfig = {
  jobsBaseUrl: 'http://app:3000',
  hourlyCron: '0 0 * * * *',
  dailyStatsCron: '0 0 9 * * *',
  weeklyStatsCron: '0 0 9 * * 1',
  monthlyStatsCron: '0 0 9 1 * *',
  sweepCron: '0 */3 * * *',
  timezone: 'UTC',
  pollIntervalMs: 5000,
  reconcileIntervalMs: 60000,
  lockMs: 600000,
  maxAttempts: 3,
  backoffBaseMs: 30000,
  jobRequestTimeoutMs: 600000,
};

const job = (overrides: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id: 1,
  jobName: 'fact-check' as ScheduledJobName,
  slotKey: 'fact-check:2026-06-08T14',
  payloadJson: '{}',
  status: 'running',
  attempts: 1,
  maxAttempts: 3,
  runAfter: '2026-06-08T14:00:00.000Z',
  lockedUntil: '2026-06-08T14:10:00.000Z',
  lastError: null,
  createdAt: '2026-06-08T14:00:00.000Z',
  updatedAt: '2026-06-08T14:00:00.000Z',
  finishedAt: null,
  ...overrides,
});

interface RepoMock extends ScheduledJobRepository {
  markSucceeded: ReturnType<typeof vi.fn>;
  scheduleRetry: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  claimNext: ReturnType<typeof vi.fn>;
}

function makeRepo(queue: (ScheduledJob | null)[]): RepoMock {
  return {
    insertDueSlot: vi.fn(async () => {}),
    claimNext: vi.fn(async () => queue.shift() ?? null),
    markSucceeded: vi.fn(async () => {}),
    scheduleRetry: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    findBySlot: vi.fn(async () => null),
  } as RepoMock;
}

const errors: unknown[][] = [];
const loggerFactory: LoggerFactory = {
  create: () => ({
    debug() {},
    info() {},
    warn() {},
    error(...args: unknown[]) {
      errors.push(args);
    },
    child() {
      return this;
    },
  }),
} as unknown as LoggerFactory;

describe('DefaultScheduledJobDispatcher.dispatchOnce', () => {
  beforeEach(() => {
    errors.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks succeeded on a 2xx response and calls the all-chats endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    const repo = makeRepo([job(), null]);
    const dispatcher = new DefaultScheduledJobDispatcher(
      config,
      repo,
      loggerFactory
    );

    await dispatcher.dispatchOnce();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://app:3000/jobs/fact-check/all',
      expect.objectContaining({ method: 'POST' })
    );
    expect(repo.markSucceeded).toHaveBeenCalledWith(1, expect.any(String));
    expect(repo.scheduleRetry).not.toHaveBeenCalled();
  });

  it('sends the period payload for fact-check-stats', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    const repo = makeRepo([
      job({
        jobName: 'fact-check-stats',
        slotKey: 'fact-check-stats:weekly:2026-W24',
        payloadJson: '{"period":"weekly"}',
      }),
      null,
    ]);
    const dispatcher = new DefaultScheduledJobDispatcher(
      config,
      repo,
      loggerFactory
    );

    await dispatcher.dispatchOnce();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://app:3000/jobs/fact-check-stats/all',
      expect.objectContaining({ body: '{"period":"weekly"}' })
    );
  });

  it('routes state-evolution to its all-chats endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);

    const repo = makeRepo([
      job({
        jobName: 'state-evolution',
        slotKey: 'state-evolution:2026-06-08T14',
        payloadJson: '{}',
      }),
      null,
    ]);
    const dispatcher = new DefaultScheduledJobDispatcher(
      config,
      repo,
      loggerFactory
    );

    await dispatcher.dispatchOnce();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://app:3000/jobs/state-evolution/all',
      expect.objectContaining({ method: 'POST', body: '{}' })
    );
    expect(repo.markSucceeded).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('schedules a retry with backoff on a non-2xx response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });
    vi.stubGlobal('fetch', fetchMock);

    const repo = makeRepo([job({ attempts: 1 }), null]);
    const dispatcher = new DefaultScheduledJobDispatcher(
      config,
      repo,
      loggerFactory
    );

    await dispatcher.dispatchOnce();

    expect(repo.scheduleRetry).toHaveBeenCalledTimes(1);
    const [id, runAfter, lastError] = repo.scheduleRetry.mock.calls[0];
    expect(id).toBe(1);
    expect(typeof runAfter).toBe('string');
    expect(lastError).toContain('500');
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('marks failed and logs an error after max attempts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });
    vi.stubGlobal('fetch', fetchMock);

    const repo = makeRepo([job({ attempts: 3 }), null]); // attempts === maxAttempts
    const dispatcher = new DefaultScheduledJobDispatcher(
      config,
      repo,
      loggerFactory
    );

    await dispatcher.dispatchOnce();

    expect(repo.markFailed).toHaveBeenCalledTimes(1);
    expect(repo.scheduleRetry).not.toHaveBeenCalled();
    expect(errors.length).toBeGreaterThan(0);
  });

  it('retries on fetch rejection (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const repo = makeRepo([job({ attempts: 1 }), null]);
    const dispatcher = new DefaultScheduledJobDispatcher(
      config,
      repo,
      loggerFactory
    );

    await dispatcher.dispatchOnce();

    expect(repo.scheduleRetry).toHaveBeenCalledTimes(1);
    expect(repo.scheduleRetry.mock.calls[0][2]).toContain('ECONNREFUSED');
  });
});
```

- [ ] **Step 2: Run tests (fail — module missing)**

Run: `pnpm test -- ScheduledJobDispatcher`
Expected: FAIL.

- [ ] **Step 3: Implement the dispatcher**

Create `src/application/scheduler/ScheduledJobDispatcher.ts`:

```typescript
import { inject, injectable, type ServiceIdentifier } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  SCHEDULED_JOB_REPOSITORY_ID,
  type ScheduledJobRepository,
} from '@/domain/repositories/ScheduledJobRepository';
import type { ScheduledJob } from '@/domain/scheduler/ScheduledJobTypes';

import {
  CRON_WORKER_CONFIG_ID,
  type CronWorkerConfig,
} from './CronWorkerConfig';

export interface ScheduledJobDispatcher {
  start(): void;
  stop(): void;
  dispatchOnce(): Promise<void>;
}

export const SCHEDULED_JOB_DISPATCHER_ID = Symbol.for(
  'ScheduledJobDispatcher'
) as ServiceIdentifier<ScheduledJobDispatcher>;

interface Endpoint {
  path: string;
  body: string;
}

function endpointFor(job: ScheduledJob): Endpoint {
  switch (job.jobName) {
    case 'state-evolution':
      return { path: '/jobs/state-evolution/all', body: '{}' };
    case 'fact-check':
      return { path: '/jobs/fact-check/all', body: '{}' };
    case 'fact-check-stats':
      return { path: '/jobs/fact-check-stats/all', body: job.payloadJson };
  }
}

@injectable()
export class DefaultScheduledJobDispatcher implements ScheduledJobDispatcher {
  private polling = false;
  private readonly logger: Logger;

  constructor(
    @inject(CRON_WORKER_CONFIG_ID) private readonly config: CronWorkerConfig,
    @inject(SCHEDULED_JOB_REPOSITORY_ID)
    private readonly repo: ScheduledJobRepository,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('ScheduledJobDispatcher');
  }

  start(): void {
    if (this.polling) return;
    this.polling = true;
    void this.poll();
  }

  stop(): void {
    this.polling = false;
  }

  async dispatchOnce(): Promise<void> {
    for (;;) {
      const now = new Date().toISOString();
      const lockedUntil = new Date(
        Date.now() + this.config.lockMs
      ).toISOString();
      const job = await this.repo.claimNext(now, lockedUntil);
      if (!job) return;
      await this.runJob(job);
    }
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    const { path, body } = endpointFor(job);
    try {
      const res = await fetch(`${this.config.jobsBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.config.jobRequestTimeoutMs),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      await this.repo.markSucceeded(job.id, new Date().toISOString());
    } catch (error) {
      await this.handleFailure(job, error);
    }
  }

  private async handleFailure(
    job: ScheduledJob,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();

    if (job.attempts >= job.maxAttempts) {
      this.logger.error(
        {
          jobName: job.jobName,
          slotKey: job.slotKey,
          attempts: job.attempts,
          lastError: message,
        },
        'Scheduled job permanently failed'
      );
      await this.repo.markFailed(job.id, message, now);
      return;
    }

    const backoffMs =
      this.config.backoffBaseMs * 2 ** Math.max(0, job.attempts - 1);
    const runAfter = new Date(Date.now() + backoffMs).toISOString();
    await this.repo.scheduleRetry(job.id, runAfter, message, now);
  }

  private async poll(): Promise<void> {
    if (!this.polling) return;
    try {
      await this.dispatchOnce();
    } catch (error) {
      this.logger.error({ error: String(error) }, 'Dispatcher poll error');
    }
    if (this.polling) {
      setTimeout(() => {
        void this.poll();
      }, this.config.pollIntervalMs);
    }
  }
}
```

- [ ] **Step 4: Run tests (pass)**

Run: `pnpm test -- ScheduledJobDispatcher`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: scheduled job dispatcher"
```

---

## Task 10: CronSlotScheduler (node-cron + reconciliation)

**Files:**
- Create: `src/application/scheduler/CronSlotScheduler.ts`
- Test: `test/CronSlotScheduler.test.ts`

- [ ] **Step 1: Write failing tests (focus on `reconcileOnce`)**

Create `test/CronSlotScheduler.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DefaultCronSlotScheduler } from '../src/application/scheduler/CronSlotScheduler';
import type { CronWorkerConfig } from '../src/application/scheduler/CronWorkerConfig';
import type { ScheduledJobRepository } from '../src/domain/repositories/ScheduledJobRepository';
import type { DueSlot } from '../src/domain/scheduler/ScheduledJobTypes';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const config: CronWorkerConfig = {
  jobsBaseUrl: 'http://app:3000',
  hourlyCron: '0 0 * * * *',
  dailyStatsCron: '0 0 9 * * *',
  weeklyStatsCron: '0 0 9 * * 1',
  monthlyStatsCron: '0 0 9 1 * *',
  sweepCron: '0 */3 * * *',
  timezone: 'UTC',
  pollIntervalMs: 5000,
  reconcileIntervalMs: 60000,
  lockMs: 600000,
  maxAttempts: 5,
  backoffBaseMs: 30000,
  jobRequestTimeoutMs: 600000,
};

const loggerFactory: LoggerFactory = {
  create: () => ({
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return this;
    },
  }),
} as unknown as LoggerFactory;

function makeRepo() {
  const inserted: DueSlot[] = [];
  const repo = {
    insertDueSlot: vi.fn(async (slot: DueSlot) => {
      inserted.push(slot);
    }),
    claimNext: vi.fn(async () => null),
    markSucceeded: vi.fn(async () => {}),
    scheduleRetry: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    findBySlot: vi.fn(async () => null),
  } as unknown as ScheduledJobRepository;
  return { repo, inserted };
}

describe('DefaultCronSlotScheduler.reconcileOnce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T14:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('inserts current and previous hourly fact-check + state-evolution slots, plus daily/weekly/monthly', async () => {
    const { repo, inserted } = makeRepo();
    const scheduler = new DefaultCronSlotScheduler(config, repo, loggerFactory);

    await scheduler.reconcileOnce();

    const keys = inserted.map((s) => s.slotKey);
    expect(keys).toContain('fact-check:2026-06-08T14');
    expect(keys).toContain('fact-check:2026-06-08T13'); // previous hour
    expect(keys).toContain('state-evolution:2026-06-08T14');
    expect(keys).toContain('state-evolution:2026-06-08T13');
    expect(keys).toContain('fact-check-stats:daily:2026-06-08');
    expect(keys).toContain('fact-check-stats:weekly:2026-W24');
    expect(keys).toContain('fact-check-stats:monthly:2026-06');
    // maxAttempts is forwarded from config
    expect(repo.insertDueSlot).toHaveBeenCalledWith(
      expect.anything(),
      5,
      expect.any(String)
    );
  });
});
```

- [ ] **Step 2: Run tests (fail — module missing)**

Run: `pnpm test -- CronSlotScheduler`
Expected: FAIL.

- [ ] **Step 3: Implement the slot scheduler**

Create `src/application/scheduler/CronSlotScheduler.ts`:

```typescript
import cron, { type ScheduledTask } from 'node-cron';
import { inject, injectable, type ServiceIdentifier } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  SCHEDULED_JOB_REPOSITORY_ID,
  type ScheduledJobRepository,
} from '@/domain/repositories/ScheduledJobRepository';
import type { DueSlot } from '@/domain/scheduler/ScheduledJobTypes';

import {
  CRON_WORKER_CONFIG_ID,
  type CronWorkerConfig,
} from './CronWorkerConfig';
import { SlotCalculator } from './SlotCalculator';

export interface CronSlotScheduler {
  start(): void;
  stop(): void;
  reconcileOnce(): Promise<void>;
}

export const CRON_SLOT_SCHEDULER_ID = Symbol.for(
  'CronSlotScheduler'
) as ServiceIdentifier<CronSlotScheduler>;

const HOUR_MS = 60 * 60 * 1000;

@injectable()
export class DefaultCronSlotScheduler implements CronSlotScheduler {
  private readonly logger: Logger;
  private readonly slots: SlotCalculator;
  private tasks: ScheduledTask[] = [];
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject(CRON_WORKER_CONFIG_ID) private readonly config: CronWorkerConfig,
    @inject(SCHEDULED_JOB_REPOSITORY_ID)
    private readonly repo: ScheduledJobRepository,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('CronSlotScheduler');
    this.slots = new SlotCalculator(config.timezone);
  }

  start(): void {
    const tz = { timezone: this.config.timezone };
    this.tasks = [
      cron.schedule(
        this.config.hourlyCron,
        () => void this.insert(this.slots.hourlyFactCheck(new Date())),
        tz
      ),
      cron.schedule(
        this.config.sweepCron,
        () => void this.insert(this.slots.stateEvolution(new Date())),
        tz
      ),
      cron.schedule(
        this.config.dailyStatsCron,
        () => void this.insert(this.slots.dailyStats(new Date())),
        tz
      ),
      cron.schedule(
        this.config.weeklyStatsCron,
        () => void this.insert(this.slots.weeklyStats(new Date())),
        tz
      ),
      cron.schedule(
        this.config.monthlyStatsCron,
        () => void this.insert(this.slots.monthlyStats(new Date())),
        tz
      ),
    ];

    void this.reconcileOnce();
    this.reconcileTimer = setInterval(() => {
      void this.reconcileOnce();
    }, this.config.reconcileIntervalMs);

    this.logger.info(
      { timezone: this.config.timezone },
      'Cron slot scheduler started'
    );
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    if (this.reconcileTimer !== null) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  async reconcileOnce(): Promise<void> {
    const now = new Date();
    const prevHour = new Date(now.getTime() - HOUR_MS);
    const slots: DueSlot[] = [
      this.slots.hourlyFactCheck(now),
      this.slots.hourlyFactCheck(prevHour),
      this.slots.stateEvolution(now),
      this.slots.stateEvolution(prevHour),
      this.slots.dailyStats(now),
      this.slots.weeklyStats(now),
      this.slots.monthlyStats(now),
    ];
    for (const slot of slots) {
      await this.insert(slot);
    }
  }

  private async insert(slot: DueSlot): Promise<void> {
    try {
      await this.repo.insertDueSlot(
        slot,
        this.config.maxAttempts,
        new Date().toISOString()
      );
    } catch (error) {
      this.logger.error(
        { error: String(error), slotKey: slot.slotKey },
        'Failed to insert due slot'
      );
    }
  }
}
```

- [ ] **Step 4: Run tests (pass)**

Run: `pnpm test -- CronSlotScheduler`
Expected: PASS.

> If `node-cron@4`'s `cron.schedule` signature differs (e.g. requires `{ scheduled: false }` or a different options shape), match the form already used in the codebase — `DefaultFactCheckScheduler.ts` (being deleted in Task 13) and the still-present usage show `cron.schedule(expr, fn, { timezone })`. The tests only exercise `reconcileOnce`, so `start()` is not under test here.

- [ ] **Step 5: Commit**

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: cron slot scheduler with reconciliation"
```

---

## Task 11: CronWorker orchestrator

**Files:**
- Create: `src/application/scheduler/CronWorker.ts`
- Test: `test/CronWorker.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/CronWorker.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

import { DefaultCronWorker } from '../src/application/scheduler/CronWorker';
import type { CronSlotScheduler } from '../src/application/scheduler/CronSlotScheduler';
import type { ScheduledJobDispatcher } from '../src/application/scheduler/ScheduledJobDispatcher';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const loggerFactory: LoggerFactory = {
  create: () => ({
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return this;
    },
  }),
} as unknown as LoggerFactory;

describe('DefaultCronWorker', () => {
  it('start() and stop() fan out to scheduler and dispatcher', () => {
    const scheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      reconcileOnce: vi.fn(async () => {}),
    } as unknown as CronSlotScheduler;
    const dispatcher = {
      start: vi.fn(),
      stop: vi.fn(),
      dispatchOnce: vi.fn(async () => {}),
    } as unknown as ScheduledJobDispatcher;

    const worker = new DefaultCronWorker(scheduler, dispatcher, loggerFactory);
    worker.start();
    worker.stop();

    expect(scheduler.start).toHaveBeenCalledTimes(1);
    expect(dispatcher.start).toHaveBeenCalledTimes(1);
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(dispatcher.stop).toHaveBeenCalledTimes(1);
  });
});
```

Run: `pnpm test -- CronWorker` → Expected: FAIL.

- [ ] **Step 2: Implement the orchestrator**

Create `src/application/scheduler/CronWorker.ts`:

```typescript
import { inject, injectable, type ServiceIdentifier } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';

import {
  CRON_SLOT_SCHEDULER_ID,
  type CronSlotScheduler,
} from './CronSlotScheduler';
import {
  SCHEDULED_JOB_DISPATCHER_ID,
  type ScheduledJobDispatcher,
} from './ScheduledJobDispatcher';

export interface CronWorker {
  start(): void;
  stop(): void;
}

export const CRON_WORKER_ID = Symbol.for(
  'CronWorker'
) as ServiceIdentifier<CronWorker>;

@injectable()
export class DefaultCronWorker implements CronWorker {
  private readonly logger: Logger;

  constructor(
    @inject(CRON_SLOT_SCHEDULER_ID)
    private readonly slotScheduler: CronSlotScheduler,
    @inject(SCHEDULED_JOB_DISPATCHER_ID)
    private readonly dispatcher: ScheduledJobDispatcher,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('CronWorker');
  }

  start(): void {
    this.slotScheduler.start();
    this.dispatcher.start();
    this.logger.info('Cron worker started');
  }

  stop(): void {
    this.dispatcher.stop();
    this.slotScheduler.stop();
    this.logger.info('Cron worker stopped');
  }
}
```

- [ ] **Step 3: Run tests (pass) + commit**

Run: `pnpm test -- CronWorker` → Expected: PASS

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: cron worker orchestrator"
```

---

## Task 12: DI module + entrypoint + build/scripts/docker

**Files:**
- Create: `src/container/cron-worker.ts`
- Create: `src/cron-worker.ts`
- Modify: `rsbuild.config.ts`
- Modify: `package.json`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: Create the DI registration module**

Create `src/container/cron-worker.ts`:

```typescript
import type { Container } from 'inversify';

import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import {
  CRON_WORKER_CONFIG_ID,
  type CronWorkerConfig,
} from '@/application/scheduler/CronWorkerConfig';
import {
  CRON_SLOT_SCHEDULER_ID,
  DefaultCronSlotScheduler,
  type CronSlotScheduler,
} from '@/application/scheduler/CronSlotScheduler';
import {
  CRON_WORKER_ID,
  DefaultCronWorker,
  type CronWorker,
} from '@/application/scheduler/CronWorker';
import {
  SCHEDULED_JOB_DISPATCHER_ID,
  DefaultScheduledJobDispatcher,
  type ScheduledJobDispatcher,
} from '@/application/scheduler/ScheduledJobDispatcher';
import {
  SCHEDULED_JOB_REPOSITORY_ID,
  type ScheduledJobRepository,
} from '@/domain/repositories/ScheduledJobRepository';
import { SQLiteScheduledJobRepository } from '@/infrastructure/persistence/sqlite/SQLiteScheduledJobRepository';

export const registerCronWorker = (container: Container): void => {
  const envService = container.get<EnvService>(ENV_SERVICE_ID);

  container
    .bind<CronWorkerConfig>(CRON_WORKER_CONFIG_ID)
    .toConstantValue(envService.getCronWorkerConfig());

  container
    .bind<ScheduledJobRepository>(SCHEDULED_JOB_REPOSITORY_ID)
    .to(SQLiteScheduledJobRepository)
    .inSingletonScope();

  container
    .bind<CronSlotScheduler>(CRON_SLOT_SCHEDULER_ID)
    .to(DefaultCronSlotScheduler)
    .inSingletonScope();

  container
    .bind<ScheduledJobDispatcher>(SCHEDULED_JOB_DISPATCHER_ID)
    .to(DefaultScheduledJobDispatcher)
    .inSingletonScope();

  container
    .bind<CronWorker>(CRON_WORKER_ID)
    .to(DefaultCronWorker)
    .inSingletonScope();
};
```

- [ ] **Step 2: Create the entrypoint (mirror `voice-worker.ts`)**

Create `src/cron-worker.ts`:

```typescript
import 'reflect-metadata';

import { Container } from 'inversify';

import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from './application/interfaces/logging/LoggerFactory';
import { CRON_WORKER_ID, type CronWorker } from './application/scheduler/CronWorker';
import { register as registerApplication } from './container/application';
import { registerCronWorker } from './container/cron-worker';
import { register as registerRepositories } from './container/repositories';

const container = new Container();
registerRepositories(container);
registerApplication(container);
registerCronWorker(container);

const loggerFactory = container.get<LoggerFactory>(LOGGER_FACTORY_ID);
const logger = loggerFactory.create('cron-worker');
const worker = container.get<CronWorker>(CRON_WORKER_ID);

logger.info('Starting cron worker');
worker.start();

function shutdown(reason: string): void {
  logger.info(`${reason} received`);
  worker.stop();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
```

> No `require.main === module` guard — rspack mis-evaluates it (see `src/migrate.ts:253`). This file executes at top level, exactly like `src/voice-worker.ts`.

- [ ] **Step 3: Register the bundler entry**

In `rsbuild.config.ts`, add `cron-worker` to `source.entry`:

```typescript
    entry: {
      index: './src/index.ts',
      migrate: './src/migrate.ts',
      'voice-worker': './src/voice-worker.ts',
      'cron-worker': './src/cron-worker.ts',
    },
```

- [ ] **Step 4: Add package scripts**

In `package.json` `scripts`, add (mirroring the voice/audio worker scripts, but with consistent `cron-worker` naming end-to-end):

```json
    "cron-worker": "node dist/cron-worker.js",
    "dev:cron-worker": "nodemon -L --watch src --ext ts --exec \"rsbuild build && node dist/cron-worker.js\"",
```

- [ ] **Step 5: Build and smoke-check the bundle exists**

Run: `pnpm build`
Then verify the artifact:

Run: `node -e "require('fs').accessSync('dist/cron-worker.js')"`
Expected: no output, exit 0 (file built). If it errors, the `rsbuild.config.ts` entry name does not match.

- [ ] **Step 6: Add the Docker services**

In `docker-compose.yml`, add under `services:` (after `audio-worker`):

```yaml
  cron-worker:
    <<: *app
    command: ['node', 'dist/cron-worker.js']
    init: true
    depends_on:
      migrate:
        condition: service_completed_successfully
      app:
        condition: service_healthy
    restart: unless-stopped
```

In `docker-compose.dev.yml`, add under `services:`:

```yaml
  cron-worker:
    <<: *dev
    command: pnpm dev:cron-worker
```

- [ ] **Step 7: Validate compose syntax**

Run: `docker compose -f docker-compose.yml config >/dev/null && docker compose -f docker-compose.yml -f docker-compose.dev.yml config >/dev/null`
Expected: exit 0, no error (compose files parse).

- [ ] **Step 8: Commit**

```bash
pnpm lint:fix && pnpm format:fix
git add -A
git commit -m "feat: cron-worker entrypoint, DI module, build entry, scripts, docker"
```

---

## Task 13: Cutover — stop the app from owning cron

Remove the in-app cron schedulers so only `cron-worker` triggers schedules. This also resolves the type errors deferred from Task 8.

**Files:**
- Delete: `src/application/fact-checking/FactCheckScheduler.ts`
- Delete: `src/application/fact-checking/DefaultFactCheckScheduler.ts`
- Delete: `test/FactCheckScheduler.test.ts`
- Modify: `src/application/behavior/StateEvolutionScheduler.ts`
- Modify: `src/application/behavior/DefaultStateEvolutionScheduler.ts`
- Modify: `test/StateEvolutionScheduler.test.ts`
- Modify: `src/view/telegram/MainService.ts`
- Modify: `src/container/application.ts`
- Modify: `src/application/fact-checking/FactCheckConfig.ts`
- Modify: `src/application/behavior/BehaviorConfig.ts`
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`

- [ ] **Step 1: Delete the fact-check scheduler (cron now lives in cron-worker)**

```bash
git rm src/application/fact-checking/FactCheckScheduler.ts \
       src/application/fact-checking/DefaultFactCheckScheduler.ts \
       test/FactCheckScheduler.test.ts
```

- [ ] **Step 2: Trim `StateEvolutionScheduler` interface to `sweep()` only**

Replace the interface body in `src/application/behavior/StateEvolutionScheduler.ts`:

```typescript
export interface StateEvolutionScheduler {
  sweep(): Promise<void>;
}
```

(Keep the `STATE_EVOLUTION_SCHEDULER_ID` export.)

- [ ] **Step 3: Drop cron from `DefaultStateEvolutionScheduler`**

In `src/application/behavior/DefaultStateEvolutionScheduler.ts`:
- Remove `import cron, { type ScheduledTask } from 'node-cron';`.
- Remove the field `private task: ScheduledTask | null = null;`.
- Delete the `start()` and `stop()` methods entirely.
- Keep the constructor and `sweep()` unchanged (it still uses `config.maxIntervalMs`, `cursorRepo`, `worker`).

- [ ] **Step 4: Update `StateEvolutionScheduler.test.ts`**

Remove any test that calls `start()` / `stop()` or asserts cron scheduling. Keep `sweep()` tests. If the test imported `node-cron` mocks for this scheduler, remove them.

- [ ] **Step 5: Remove scheduler wiring from `MainService`**

In `src/view/telegram/MainService.ts`:
- Remove the imports of `FACT_CHECK_SCHEDULER_ID` / `FactCheckScheduler` and `STATE_EVOLUTION_SCHEDULER_ID` / `StateEvolutionScheduler`.
- Remove the fields `private readonly stateEvolutionScheduler: StateEvolutionScheduler;` and `private readonly factCheckScheduler: FactCheckScheduler;`.
- Remove their constructor params and the assignments `this.stateEvolutionScheduler = ...` / `this.factCheckScheduler = ...`.
- Replace `launch()` with the trimmed version:

```typescript
  public async launch(): Promise<void> {
    await this.messenger.launch().catch((error) => this.logger.error(error));
  }
```

(`DefaultJobRunner` still injects `STATE_EVOLUTION_SCHEDULER_ID` for `sweep()` — that binding stays in the container. Only `MainService`'s use is removed.)

- [ ] **Step 6: Remove the fact-check scheduler binding from the container**

In `src/container/application.ts`:
- Remove the import block for `FACT_CHECK_SCHEDULER_ID` / `FactCheckScheduler` and `import { DefaultFactCheckScheduler } ...`.
- Remove the binding:

```typescript
  container
    .bind<FactCheckScheduler>(FACT_CHECK_SCHEDULER_ID)
    .to(DefaultFactCheckScheduler)
    .inSingletonScope();
```

Leave the `StateEvolutionScheduler` binding (`DefaultStateEvolutionScheduler`) in place — `DefaultJobRunner` depends on it for `sweep()`.

- [ ] **Step 7: Relocate the now-dead cron config fields**

With both scheduler classes deleted/trimmed, the cron fields they read are dead. Remove them so `CronWorkerConfig` is the sole owner:
- In `src/application/fact-checking/FactCheckConfig.ts`, delete `hourlyCron`, `dailyStatsCron`, `weeklyStatsCron`, `monthlyStatsCron`, and `timezone` from the interface (keep `enabled` and all `max*` / threshold fields).
- In **both** `src/infrastructure/config/DefaultEnvService.ts` and `src/infrastructure/config/TestEnvService.ts`, delete those five lines from `getFactCheckConfig()`. Keep the `FACT_CHECK_*_CRON` / `FACT_CHECK_TIMEZONE` env keys — `getCronWorkerConfig()` still reads them.
- In `src/application/behavior/BehaviorConfig.ts`, remove `sweepCron: string;` from `interface StateEvolutionConfig` and `sweepCron: '0 */3 * * *',` from `DEFAULT_STATE_EVOLUTION_CONFIG`.

If any fact-check test asserts on `hourlyCron`/`timezone` from `getFactCheckConfig()`, remove those assertions.

- [ ] **Step 8: Type-check + full suite**

Run: `pnpm type:check` → Expected: PASS
Run: `pnpm test` → Expected: PASS

Fix any remaining test that constructed `MainService` with the removed scheduler params (update the constructor call / DI usage in that test). There is no longer a meaningful "MainService starts cron" assertion — the schedulers are gone from `MainService` entirely; the updated `MainService` test should simply verify `launch()` calls `messenger.launch()`.

- [ ] **Step 9: Commit**

```bash
pnpm lint:fix && pnpm format:fix && pnpm build
git add -A
git commit -m "refactor: remove in-app cron schedulers; app no longer owns cron"
```

---

## Task 14: Final verification

- [ ] **Step 1: Clean build + full type-check + full test run**

Run: `pnpm build && pnpm type:check && pnpm test`
Expected: all PASS.

- [ ] **Step 2: Confirm no stale references remain**

Run: `rg -n "topic-of-day|topicOfDay|TopicOfDay|topic_time|topic_timezone|FactCheckScheduler|generateTopicOfDay" src test scripts package.json`
Expected: no matches (behavior-state `patch.topic` lines are a different identifier and will not match these patterns).

- [ ] **Step 3: Confirm the four build entries exist**

Run: `node -e "['index','migrate','voice-worker','cron-worker'].forEach(n=>require('fs').accessSync('dist/'+n+'.js'))"`
Expected: exit 0.

- [ ] **Step 4: Manual smoke (optional, requires running app + DB)**

Bring up the stack (`pnpm docker:dev` or run `app` then `cron-worker` locally with a migrated DB). Within a couple of minutes the reconciliation loop should insert rows; verify:

```bash
node -e "const s=require('sqlite3');const db=new s.Database('data/memory.db');db.all('SELECT job_name,slot_key,status,attempts FROM scheduled_jobs ORDER BY id DESC LIMIT 10',(e,r)=>{console.log(e||r);db.close();});"
```

Expected: recent `pending`/`succeeded` rows for `fact-check` / `state-evolution` / `fact-check-stats`. (Skip if no local runtime; the automated tests already cover the logic.)

- [ ] **Step 5: Finalize**

Use the `superpowers:finishing-a-development-branch` skill to decide merge / PR / cleanup.

---

## Notes / out of scope

- The pre-existing `audio-worker` naming mismatch (`package.json` + `docker-compose.yml` reference `dist/audio-worker.js`, but the bundler emits `voice-worker.js`) is **not** fixed here — it is unrelated to this feature. The new `cron-worker` is kept internally consistent to avoid repeating that mistake.
- A proactive Telegram alert on permanent failure is intentionally out of scope (spec Non-Goals). Permanent failures surface via the structured error log (Task 9) and the persisted `failed` / `last_error` row.
- App job execution stays synchronous; making it async (`202 Accepted`) is a future design (spec Non-Goals).
