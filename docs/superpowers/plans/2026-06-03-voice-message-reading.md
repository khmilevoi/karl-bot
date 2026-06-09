# Voice Message Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Telegram voice message support by storing transcribed voice text in `messages` and processing audio through a dedicated SQLite-backed `audio-worker`.

**Architecture:** The Telegram layer only accepts the update and calls an application use case. The application layer owns enqueueing, retry/cancellation rules, and worker orchestration through interfaces. SQLite queue storage, Telegram file download, ffmpeg conversion, and OpenAI transcription stay in infrastructure implementations bound through Inversify.

**Tech Stack:** TypeScript, grammy, Inversify, SQLite, OpenAI Node SDK, ffmpeg, RSBuild, Vitest, Docker.

---

## Source Spec

Use this plan with:

- `docs/superpowers/specs/2026-06-03-voice-message-reading-design.md`
- `CLAUDE.md`
- `AGENTS.md`

Important project rule: never commit files under `docs/superpowers/`.

## File Structure

### Create

- `migrations/019_voice_messages_and_jobs.up.sql` - adds message metadata and voice job queue.
- `migrations/019_voice_messages_and_jobs.down.sql` - removes voice queue and message metadata.
- `src/domain/voice/VoiceTypes.ts` - source/status/job domain types.
- `src/domain/repositories/VoiceTranscriptionJobRepository.ts` - queue repository interface.
- `src/application/interfaces/voice/VoiceMessageService.ts` - app use case for enqueueing Telegram voice messages.
- `src/application/interfaces/voice/VoiceMessageWorker.ts` - worker process interface.
- `src/application/interfaces/voice/TelegramFileDownloadService.ts` - Telegram file download abstraction.
- `src/application/interfaces/voice/AudioConversionService.ts` - ffmpeg abstraction.
- `src/application/interfaces/voice/AudioTranscriptionService.ts` - OpenAI STT abstraction.
- `src/application/voice/VoiceConfig.ts` - worker/transcription config and DI symbol.
- `src/application/use-cases/voice/DefaultVoiceMessageService.ts` - creates pending message + queue job.
- `src/application/use-cases/voice/DefaultVoiceMessageWorker.ts` - claims jobs, processes audio, retries, cancels.
- `src/infrastructure/persistence/sqlite/SQLiteVoiceTranscriptionJobRepository.ts` - SQLite queue implementation.
- `src/infrastructure/external/TelegramFileDownloadService.ts` - downloads Telegram file bytes.
- `src/infrastructure/external/FfmpegAudioConversionService.ts` - converts audio to supported upload format.
- `src/infrastructure/external/OpenAIAudioTranscriptionService.ts` - OpenAI Audio API transcription.
- `src/audio-worker.ts` - worker entrypoint.
- `test/voiceMigration019.test.ts`
- `test/SQLiteVoiceTranscriptionJobRepository.test.ts`
- `test/VoiceMessageService.test.ts`
- `test/VoiceMessageWorker.test.ts`
- `test/TelegramVoiceRouting.test.ts`
- `test/VoiceExternalServices.test.ts`

### Modify

- `src/domain/messages/ChatMessage.ts` - add `sourceType` and `processingStatus`.
- `src/domain/messages/StoredMessage.ts` - inherits new message metadata.
- `src/domain/repositories/MessageRepository.ts` - add voice status update/read methods.
- `src/application/interfaces/messages/MessageService.ts` - expose voice status update/read methods.
- `src/application/use-cases/messages/RepositoryMessageService.ts` - delegate voice status methods.
- `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts` - store metadata, filter non-ready history, update voice transcript status.
- `src/infrastructure/persistence/sqlite/DbProvider.ts` - set SQLite WAL and busy timeout for bot + worker process access.
- `src/application/interfaces/env/EnvService.ts` - add `getVoiceConfig()` AND the six `VOICE_*` fields to the `Env` interface (so `DefaultEnvService.env` exposes them type-safely; the project bans `any`/casts).
- `src/infrastructure/config/envSchema.ts` - parse voice env values.
- `src/infrastructure/config/DefaultEnvService.ts` - default voice config.
- `src/infrastructure/config/TestEnvService.ts` - test voice config defaults.
- `src/container/application.ts` - bind voice services, config, repositories, and external adapters.
- `src/container/repositories.ts` - bind voice job repository if repository bindings live there.
- `src/view/telegram/routes.ts` - route `message:voice`.
- `src/view/telegram/MainService.ts` - call `VoiceMessageService` from voice handler.
- `src/view/telegram/context.ts` - only if test context typing needs a voice update shape.
- `src/infrastructure/external/ChatGPTService.ts` - no voice logic; leave behavior model use unchanged.
- `src/application/behavior/DefaultBehaviorContextAssembler.ts` - no direct change if repository filters ready messages correctly; verify tests.
- `src/application/use-cases/chat/DefaultChatResetService.ts` - no direct change if message `is_active` remains the cancellation guard; verify tests.
- `src/migrate.ts` - guard the module-level CLI auto-run behind `require.main === module` so importing it from tests (e.g. the voice migration test) does NOT fire a second, racing `migrateUp()`.
- `rsbuild.config.ts` - add `audio-worker` entry under `source.entry`.
- `package.json` - add `audio-worker` script.
- `Dockerfile` - install `ffmpeg` in the runtime stage and convert the launch to `ENTRYPOINT` (migration script) + command-aware `CMD`. NOTE: the Dockerfile already uses pnpm (`npm i -g pnpm` + `pnpm install --frozen-lockfile` + `pnpm build` + `pnpm prune --prod`) — do NOT "switch to pnpm".
- `docker-compose.yml` - add a second `worker` service (same build/target `runtime`, same `./data` volume, same `.env`, command `node dist/audio-worker.js`).
- `docker-compose.dev.yml` - add the dev `worker` override (target `deps`, watch-style command) alongside the existing `app` service.
- `.env.example` - document voice env values.
- Existing tests in `test/sqliteRepositories.test.ts`, `test/RepositoryMessageService.test.ts`, `test/MainService.test.ts`, and `test/container.behavior.test.ts`.

---

## Task 1: Domain Types And Migration

**Files:**
- Create: `src/domain/voice/VoiceTypes.ts`
- Create: `src/domain/repositories/VoiceTranscriptionJobRepository.ts`
- Create: `migrations/019_voice_messages_and_jobs.up.sql`
- Create: `migrations/019_voice_messages_and_jobs.down.sql`
- Modify: `src/domain/messages/ChatMessage.ts`
- Modify: `src/migrate.ts` (guard CLI auto-run — see note under Step 1)
- Test: `test/voiceMigration019.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `test/voiceMigration019.test.ts` with a temp SQLite DB that applies all migrations through `migrateUp()` and asserts:

```ts
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 019 voice messages and jobs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('adds message metadata and voice job table', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'voice-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const messageColumns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(messages)'
    );
    const voiceColumns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(voice_transcription_jobs)'
    );
    await db.close();

    expect(messageColumns.map((c) => c.name)).toContain('source_type');
    expect(messageColumns.map((c) => c.name)).toContain('processing_status');
    expect(voiceColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'message_id',
        'chat_id',
        'telegram_message_id',
        'telegram_file_id',
        'status',
        'attempts',
        'available_at',
        'locked_until',
        'last_error',
        'created_at',
        'updated_at',
      ])
    );
  });
});
```

> **Race warning:** `src/migrate.ts` runs `migrateUp()/migrateDown()/checkMigrations()` at module load based on `process.argv[2]`. Importing it in this test (real temp DB, sqlite NOT mocked) fires a fire-and-forget `migrateUp()` that races the explicit `await migrateUp()` — migration 019's `CREATE TABLE` is not `IF NOT EXISTS`, so the loser can throw. `test/integration/setup.ts` only survives this by a timing gap. Before relying on this test, wrap the CLI dispatch block at the bottom of `src/migrate.ts` in `if (require.main === module) { ... }` so importing the module is side-effect-free. Verify the bundled `dist/migrate.js` (CJS, `output.module: false`) still self-runs via the entrypoint `node dist/migrate.js up`.

- [ ] **Step 2: Run the migration test to verify it fails**

Run:

```bash
pnpm test -- test/voiceMigration019.test.ts
```

Expected: FAIL because migration 019 and voice columns/table do not exist.

- [ ] **Step 3: Add domain voice types**

Create `src/domain/voice/VoiceTypes.ts`:

```ts
export type MessageSourceType = 'text' | 'voice';
export type MessageProcessingStatus = 'ready' | 'pending' | 'failed';

export type VoiceTranscriptionJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface VoiceTranscriptionJob {
  id: number;
  messageId: number;
  chatId: number;
  telegramMessageId: number;
  telegramFileId: string;
  status: VoiceTranscriptionJobStatus;
  attempts: number;
  availableAt: string;
  lockedUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewVoiceTranscriptionJob {
  chatId: number;
  telegramMessageId: number;
  telegramFileId: string;
  availableAt: string;
}
```

Modify `src/domain/messages/ChatMessage.ts`:

```ts
import type {
  MessageProcessingStatus,
  MessageSourceType,
} from '@/domain/voice/VoiceTypes';

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  sourceType?: MessageSourceType;
  processingStatus?: MessageProcessingStatus;
  // existing fields stay unchanged
}
```

- [ ] **Step 4: Add voice job repository interface**

Create `src/domain/repositories/VoiceTranscriptionJobRepository.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';
import type { StoredMessage } from '@/domain/messages/StoredMessage';
import type {
  NewVoiceTranscriptionJob,
  VoiceTranscriptionJob,
} from '@/domain/voice/VoiceTypes';

export interface VoiceTranscriptionJobRepository {
  createPendingMessageAndJob(
    message: StoredMessage,
    job: NewVoiceTranscriptionJob
  ): Promise<VoiceTranscriptionJob>;
  claimNext(now: string, lockedUntil: string): Promise<VoiceTranscriptionJob | null>;
  markDone(jobId: number, now: string): Promise<void>;
  requeue(jobId: number, availableAt: string, lastError: string, now: string): Promise<void>;
  markFailed(jobId: number, lastError: string, now: string): Promise<void>;
  markCancelled(jobId: number, reason: string, now: string): Promise<void>;
}

export const VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID = Symbol.for(
  'VoiceTranscriptionJobRepository'
) as ServiceIdentifier<VoiceTranscriptionJobRepository>;
```

- [ ] **Step 5: Add migration SQL**

Create `migrations/019_voice_messages_and_jobs.up.sql`:

```sql
BEGIN TRANSACTION;

ALTER TABLE messages ADD COLUMN source_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'ready';

CREATE TABLE voice_transcription_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  telegram_file_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

CREATE INDEX idx_voice_jobs_pick
  ON voice_transcription_jobs(status, available_at, locked_until);

COMMIT;
```

Create `migrations/019_voice_messages_and_jobs.down.sql`:

```sql
BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_voice_jobs_pick;
DROP TABLE IF EXISTS voice_transcription_jobs;

CREATE TABLE messages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER,
  role TEXT,
  content TEXT,
  user_id INTEGER NOT NULL,
  reply_text TEXT,
  reply_username TEXT,
  quote_text TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
);

INSERT INTO messages_new (
  id,
  chat_id,
  message_id,
  role,
  content,
  user_id,
  reply_text,
  reply_username,
  quote_text,
  is_active
)
SELECT
  id,
  chat_id,
  message_id,
  role,
  content,
  user_id,
  reply_text,
  reply_username,
  quote_text,
  is_active
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

COMMIT;
```

- [ ] **Step 6: Run migration test**

Run:

```bash
pnpm test -- test/voiceMigration019.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
pnpm type:check
```

Expected: PASS.

---

## Task 2: Message Repository Status Support

**Files:**
- Modify: `src/domain/repositories/MessageRepository.ts`
- Modify: `src/application/interfaces/messages/MessageService.ts`
- Modify: `src/application/use-cases/messages/RepositoryMessageService.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts`
- Modify: `test/sqliteRepositories.test.ts`
- Test: `test/RepositoryMessageService.test.ts`

> **Blast radius of the `findByIds` filter:** `getMessagesByIds` (which calls `findByIds`) is consumed by BOTH `DefaultBehaviorContextAssembler` and `DefaultStateEvolutionContextAssembler`. Adding `is_active = 1 AND processing_status = 'ready'` is a real behavior change — previously `findByIds` returned soft-deleted rows. Both context paths must be re-verified (see Step 7), not just the behavior one.

- [ ] **Step 1: Write failing repository tests**

Add tests to `test/sqliteRepositories.test.ts`:

```ts
it('does not return pending voice messages in normal history reads', async () => {
  await chatRepo.upsert(new ChatEntity(1));
  await userRepo.upsert(new UserEntity(1, 'alice'));
  const pendingId = await messageRepo.insert({
    chatId: 1,
    role: 'user',
    content: '[voice:pending]',
    userId: 1,
    sourceType: 'voice',
    processingStatus: 'pending',
  });
  const readyId = await messageRepo.insert({
    chatId: 1,
    role: 'user',
    content: 'ready',
    userId: 1,
  });

  expect(await messageRepo.findByChatId(1)).toEqual([
    expect.objectContaining({ id: readyId, content: 'ready' }),
  ]);
  expect(await messageRepo.countByChatId(1)).toBe(1);
  expect(await messageRepo.findLastByChatId(1, 10)).toEqual([
    expect.objectContaining({ id: readyId, content: 'ready' }),
  ]);
  expect(await messageRepo.findByIds([pendingId, readyId])).toEqual([
    expect.objectContaining({ id: readyId, content: 'ready' }),
  ]);
});

it('marks pending voice messages ready with transcript', async () => {
  await chatRepo.upsert(new ChatEntity(1));
  await userRepo.upsert(new UserEntity(1, 'alice'));
  const id = await messageRepo.insert({
    chatId: 1,
    role: 'user',
    content: '[voice:pending]',
    userId: 1,
    sourceType: 'voice',
    processingStatus: 'pending',
  });

  const updated = await messageRepo.markVoiceTranscribed(id, '[voice] hello');

  expect(updated).toEqual(
    expect.objectContaining({
      id,
      content: '[voice] hello',
      sourceType: 'voice',
      processingStatus: 'ready',
    })
  );
});
```

Also update the manual temp `CREATE TABLE messages` in this test file to include:

```sql
source_type TEXT NOT NULL DEFAULT 'text',
processing_status TEXT NOT NULL DEFAULT 'ready',
```

Update the existing soft-delete test in `test/sqliteRepositories.test.ts`: after `clearByChatId`, `findByIds([messageId])` should return `[]`. The new invariant is that reads used by prompt and behavior paths only expose active ready messages.

- [ ] **Step 2: Run repository tests to verify they fail**

Run:

```bash
pnpm test -- test/sqliteRepositories.test.ts
```

Expected: FAIL because repository does not know voice metadata or ready filtering.

- [ ] **Step 3: Extend repository and service interfaces**

Modify `src/domain/repositories/MessageRepository.ts`:

```ts
import type { StoredMessage } from '@/domain/messages/StoredMessage';

export interface MessageRepository {
  insert(message: StoredMessage): Promise<number>;
  findByChatId(chatId: number): Promise<ChatMessage[]>;
  findByIds(ids: readonly number[]): Promise<ChatMessage[]>;
  countByChatId(chatId: number): Promise<number>;
  findLastByChatId(chatId: number, limit: number): Promise<ChatMessage[]>;
  clearByChatId(chatId: number): Promise<void>;
  findPendingVoiceById(messageId: number): Promise<StoredMessage | null>;
  markVoiceTranscribed(messageId: number, content: string): Promise<StoredMessage | null>;
  markVoiceFailed(messageId: number): Promise<void>;
}
```

Modify `src/application/interfaces/messages/MessageService.ts` with the same three new methods.

- [ ] **Step 4: Implement ready filtering and voice updates in SQLite repository**

Modify `SQLiteMessageRepository.ts`:

- Add `source_type` and `processing_status` to `MessageRow`.
- Include them in `SELECT_MESSAGE_COLUMNS`.
- Map them to `sourceType` and `processingStatus`.
- Insert `source_type` and `processing_status`.
- Add `AND m.is_active = 1 AND m.processing_status = 'ready'` to history/count/last/id reads, including `findByIds`.
- Implement `findPendingVoiceById`, `markVoiceTranscribed`, and `markVoiceFailed`.

Use parameterized SQL:

```ts
async markVoiceTranscribed(
  messageId: number,
  content: string
): Promise<StoredMessage | null> {
  const db = await this.dbProvider.get();
  await db.run(
    "UPDATE messages SET content = ?, processing_status = 'ready' WHERE id = ? AND is_active = 1 AND source_type = 'voice' AND processing_status = 'pending'",
    content,
    messageId
  );
  return this.findPendingOrReadyVoiceById(messageId, 'ready');
}
```

Keep helper names private and avoid `any`.

- [ ] **Step 5: Delegate through `RepositoryMessageService`**

Modify `RepositoryMessageService.ts` to expose the new methods by calling the repository. Do not add SQL here.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm test -- test/sqliteRepositories.test.ts test/RepositoryMessageService.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run behavior AND state-evolution context tests**

Run:

```bash
pnpm test -- test/BehaviorContextAssembler.test.ts test/BehaviorPipeline.test.ts test/StateEvolutionContextAssembler.test.ts test/StateEvolutionPass.test.ts
```

Expected: PASS. This verifies pending voice placeholders do not leak into prompt context AND that the state-evolution path (which also uses `getMessagesByIds`) still resolves its selected messages after the `ready`/`is_active` filter is added.

---

## Task 3: SQLite Voice Job Queue Repository

**Files:**
- Create: `src/infrastructure/persistence/sqlite/SQLiteVoiceTranscriptionJobRepository.ts`
- Modify: `src/infrastructure/persistence/sqlite/DbProvider.ts`
- Modify: `src/container/repositories.ts`
- Test: `test/SQLiteVoiceTranscriptionJobRepository.test.ts`

- [ ] **Step 1: Write failing queue repository tests**

Create `test/SQLiteVoiceTranscriptionJobRepository.test.ts` with a temp DB and tests for:

- `createPendingMessageAndJob` inserts one pending `messages` row and one queued job in one transaction.
- `createPendingMessageAndJob` upserts the chat, user, and chat-user link before inserting the message.
- `claimNext` returns the oldest due queued job and locks it.
- `claimNext` can reclaim stale running jobs whose `locked_until` is past.
- `requeue` changes status back to `queued`, sets `available_at`, and stores `last_error`.
- `markDone`, `markFailed`, and `markCancelled` update status and timestamps.

Representative test:

```ts
it('creates pending message and queued job atomically', async () => {
  const repo = makeRepo();
  const job = await repo.createPendingMessageAndJob(
    {
      chatId: 1,
      role: 'user',
      content: '[voice:pending]',
      userId: 10,
      messageId: 99,
      sourceType: 'voice',
      processingStatus: 'pending',
    },
    {
      chatId: 1,
      telegramMessageId: 99,
      telegramFileId: 'file-id',
      availableAt: '2026-06-03T00:00:00.000Z',
    }
  );

  expect(job).toEqual(
    expect.objectContaining({
      chatId: 1,
      telegramMessageId: 99,
      telegramFileId: 'file-id',
      status: 'queued',
      attempts: 0,
    })
  );
});
```

- [ ] **Step 2: Run queue repository test to verify it fails**

Run:

```bash
pnpm test -- test/SQLiteVoiceTranscriptionJobRepository.test.ts
```

Expected: FAIL because repository does not exist.

- [ ] **Step 3: Implement SQLite queue repository**

Create `src/infrastructure/persistence/sqlite/SQLiteVoiceTranscriptionJobRepository.ts`.

Rules:

- Inject `DB_PROVIDER_ID`, plus `CHAT_REPOSITORY_ID`, `USER_REPOSITORY_ID`, and `CHAT_USER_REPOSITORY_ID`.
- The spec only requires the **message + job** to be atomic together. Do NOT re-implement the chat/user/chat_user upsert SQL inline — that logic already lives in `SQLiteChatRepository` / `SQLiteUserRepository` / `SQLiteChatUserRepository` and would drift. Instead:
  - First call the injected repositories to `upsert` the chat, `upsert` the user, and `link` chat↔user (these are idempotent — safe to run outside the transaction). This mirrors `RepositoryMessageService.addMessage` without duplicating its SQL.
  - Then open `BEGIN IMMEDIATE` and inside it run only: `INSERT INTO messages (...)` and `INSERT INTO voice_transcription_jobs (...)`, then `COMMIT` (or `ROLLBACK` on error). All four repos share the same singleton `DbProvider` connection, so these run sequentially on one connection.
- In `claimNext`, use a transaction to select one due job and update it to `running`.
- Treat stale running jobs as claimable:

```sql
WHERE
  (status = 'queued' AND available_at <= ?)
  OR (status = 'running' AND locked_until IS NOT NULL AND locked_until <= ?)
ORDER BY available_at ASC, id ASC
LIMIT 1
```

- Increment `attempts` when claiming.
- Return mapped domain objects with camelCase fields.

- [ ] **Step 4: Harden SQLite for bot + worker processes**

Modify `src/infrastructure/persistence/sqlite/DbProvider.ts` so after opening the database it runs:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Keep this SQLite-specific behavior in infrastructure.

- [ ] **Step 5: Bind repository**

If repository bindings are in `src/container/repositories.ts`, bind:

```ts
container
  .bind<VoiceTranscriptionJobRepository>(VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID)
  .to(SQLiteVoiceTranscriptionJobRepository)
  .inSingletonScope();
```

- [ ] **Step 6: Run queue repository tests**

Run:

```bash
pnpm test -- test/SQLiteVoiceTranscriptionJobRepository.test.ts
```

Expected: PASS.

---

## Task 4: Voice Configuration

**Files:**
- Create: `src/application/voice/VoiceConfig.ts`
- Modify: `src/application/interfaces/env/EnvService.ts`
- Modify: `src/infrastructure/config/envSchema.ts`
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`
- Modify: `.env.example`
- Test: `test/EnvService.test.ts`

- [ ] **Step 1: Write failing env tests**

Add tests in `test/EnvService.test.ts` for default voice values:

```ts
expect(service.getVoiceConfig()).toEqual({
  workerConcurrency: 1,
  workerPollIntervalMs: 1000,
  workerLockMs: 300000,
  workerMaxAttempts: 3,
  transcriptionModel: 'gpt-4o-mini-transcribe',
  maxDurationSeconds: 120,
});
```

- [ ] **Step 2: Run env tests to verify they fail**

Run:

```bash
pnpm test -- test/EnvService.test.ts
```

Expected: FAIL because `getVoiceConfig` does not exist.

- [ ] **Step 3: Add config type and symbol**

Create `src/application/voice/VoiceConfig.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

export interface VoiceConfig {
  workerConcurrency: number;
  workerPollIntervalMs: number;
  workerLockMs: number;
  workerMaxAttempts: number;
  transcriptionModel: string;
  maxDurationSeconds: number;
}

export const VOICE_CONFIG_ID = Symbol.for(
  'VoiceConfig'
) as ServiceIdentifier<VoiceConfig>;
```

- [ ] **Step 4: Extend env parsing and service**

Add optional env schema values with defaults:

```ts
VOICE_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
VOICE_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
VOICE_WORKER_LOCK_MS: z.coerce.number().int().positive().default(300000),
VOICE_WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
VOICE_TRANSCRIPTION_MODEL: z.string().min(1).default('gpt-4o-mini-transcribe'),
VOICE_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(120),
```

Also add these six keys to the `Env` interface in `src/application/interfaces/env/EnvService.ts`. `DefaultEnvService` does `this.env = envSchema.parse(process.env)` typed as `Env`; without the interface fields, `getVoiceConfig()` cannot read them without a cast (banned). `TestEnvService` parses an explicit literal — since the schema keys have `.default(...)`, the voice values are still populated even though the literal omits them.

Add `getVoiceConfig(): VoiceConfig` to `EnvService`, `DefaultEnvService`, and `TestEnvService`. Implement it by mapping the parsed `this.env.VOICE_*` fields into the `VoiceConfig` shape (no hardcoded duplicates).

- [ ] **Step 5: Bind voice config**

In `src/container/application.ts`, bind `VOICE_CONFIG_ID` to `envService.getVoiceConfig()` using a factory or constant value after env service is available. Follow existing config binding style where possible.

- [ ] **Step 6: Update `.env.example`**

Document:

```dotenv
VOICE_WORKER_CONCURRENCY=1
VOICE_WORKER_POLL_INTERVAL_MS=1000
VOICE_WORKER_LOCK_MS=300000
VOICE_WORKER_MAX_ATTEMPTS=3
VOICE_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
VOICE_MAX_DURATION_SECONDS=120
```

- [ ] **Step 7: Run env tests**

Run:

```bash
pnpm test -- test/EnvService.test.ts
```

Expected: PASS.

---

## Task 5: Voice Enqueue Use Case

**Files:**
- Create: `src/application/interfaces/voice/VoiceMessageService.ts`
- Create: `src/application/use-cases/voice/DefaultVoiceMessageService.ts`
- Modify: `src/container/application.ts`
- Test: `test/VoiceMessageService.test.ts`

- [ ] **Step 1: Write failing use-case tests**

Create `test/VoiceMessageService.test.ts`.

Test:

- It builds a pending voice message preserving chat/user/reply metadata.
- It calls `VoiceTranscriptionJobRepository.createPendingMessageAndJob`.
- It rejects missing chat/user/message/file ids.
- It rejects duration above `VOICE_MAX_DURATION_SECONDS`.
- It does not call `BehaviorPipeline`.

Representative test shape:

```ts
it('enqueues a pending voice message and job', async () => {
  const repo = {
    createPendingMessageAndJob: vi.fn().mockResolvedValue({
      id: 1,
      messageId: 10,
      chatId: 1,
      telegramMessageId: 99,
      telegramFileId: 'file-id',
      status: 'queued',
      attempts: 0,
      availableAt: now,
      lockedUntil: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }),
  } as unknown as VoiceTranscriptionJobRepository;

  const service = makeService({ repo });

  const result = await service.enqueue({
    chatId: 1,
    chatTitle: 'Chat',
    telegramMessageId: 99,
    telegramFileId: 'file-id',
    durationSeconds: 12,
    user: {
      id: 10,
      username: 'alice',
      firstName: 'Alice',
      lastName: 'Smith',
      fullName: 'Alice Smith',
    },
    context: {
      username: 'alice',
      fullName: 'Alice Smith',
    },
  });

  expect(result.kind).toBe('queued');
  expect(repo.createPendingMessageAndJob).toHaveBeenCalledWith(
    expect.objectContaining({
      chatId: 1,
      role: 'user',
      content: '[voice:pending]',
      userId: 10,
      sourceType: 'voice',
      processingStatus: 'pending',
    }),
    expect.objectContaining({
      chatId: 1,
      telegramMessageId: 99,
      telegramFileId: 'file-id',
    })
  );
});
```

- [ ] **Step 2: Run use-case tests to verify they fail**

Run:

```bash
pnpm test -- test/VoiceMessageService.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Add interface**

Create `src/application/interfaces/voice/VoiceMessageService.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';
import type { MessageContext } from '@/application/interfaces/messages/MessageContextExtractor';

export interface VoiceTelegramUser {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
}

export interface EnqueueVoiceMessageInput {
  chatId: number;
  chatTitle?: string;
  telegramMessageId: number;
  telegramFileId: string;
  durationSeconds?: number;
  user: VoiceTelegramUser;
  context: MessageContext;
}

export type EnqueueVoiceMessageResult =
  | { kind: 'queued'; jobId: number; messageId: number }
  | {
      kind: 'rejected';
      reason: 'duration_too_long' | 'missing_file_id' | 'invalid_input';
    };

export interface VoiceMessageService {
  enqueue(input: EnqueueVoiceMessageInput): Promise<EnqueueVoiceMessageResult>;
}

export const VOICE_MESSAGE_SERVICE_ID = Symbol.for(
  'VoiceMessageService'
) as ServiceIdentifier<VoiceMessageService>;
```

- [ ] **Step 4: Implement service**

Create `src/application/use-cases/voice/DefaultVoiceMessageService.ts`.

Rules:

- Inject `VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID`.
- Inject `VOICE_CONFIG_ID`.
- Do not import grammy types here.
- Convert input into `StoredMessage`.
- Set `content = '[voice:pending]'`, `sourceType = 'voice'`, `processingStatus = 'pending'`.
- Pass `availableAt = new Date().toISOString()`.
- Return job and message ids.

- [ ] **Step 5: Bind service**

In `src/container/application.ts`, bind:

```ts
container
  .bind<VoiceMessageService>(VOICE_MESSAGE_SERVICE_ID)
  .to(DefaultVoiceMessageService)
  .inSingletonScope();
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm test -- test/VoiceMessageService.test.ts
```

Expected: PASS.

---

## Task 6: Voice Worker Use Case

**Files:**
- Create: `src/application/interfaces/voice/VoiceMessageWorker.ts`
- Create: `src/application/interfaces/voice/TelegramFileDownloadService.ts`
- Create: `src/application/interfaces/voice/AudioConversionService.ts`
- Create: `src/application/interfaces/voice/AudioTranscriptionService.ts`
- Create: `src/application/use-cases/voice/DefaultVoiceMessageWorker.ts`
- Modify: `src/container/application.ts`
- Test: `test/VoiceMessageWorker.test.ts`

- [ ] **Step 1: Write failing worker tests**

Create tests for:

- Successful job: claim, download, convert, transcribe, update message, call behavior pipeline, mark done.
- Cancellation: if `markVoiceTranscribed` returns `null`, mark job cancelled and do not call pipeline.
- Retry: failed download/convert/transcribe below max attempts requeues with backoff.
- Final failure: failure at max attempts marks job failed and marks message failed.
- Empty transcript: treats as failure.

Representative success test:

```ts
it('processes a claimed voice job and sends the ready message to behavior pipeline', async () => {
  const now = '2026-06-03T00:00:00.000Z';
  const job = makeJob({ attempts: 1 });
  const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(job) });
  const messages = {
    markVoiceTranscribed: vi.fn().mockResolvedValue({
      id: job.messageId,
      chatId: job.chatId,
      role: 'user',
      content: '[voice] hello Carl',
      sourceType: 'voice',
      processingStatus: 'ready',
    }),
    markVoiceFailed: vi.fn(),
  } as unknown as MessageService;
  const behavior = { handleStoredMessage: vi.fn().mockResolvedValue({ kind: 'queued' }) };

  const worker = makeWorker({ repo, messages, behavior, now });

  await worker.drainOnce();

  expect(messages.markVoiceTranscribed).toHaveBeenCalledWith(job.messageId, '[voice] hello Carl');
  expect(behavior.handleStoredMessage).toHaveBeenCalledWith({
    message: expect.objectContaining({ id: job.messageId, content: '[voice] hello Carl' }),
    directTrigger: null,
  });
  expect(repo.markDone).toHaveBeenCalledWith(job.id, expect.any(String));
});
```

- [ ] **Step 2: Run worker tests to verify they fail**

Run:

```bash
pnpm test -- test/VoiceMessageWorker.test.ts
```

Expected: FAIL because worker interfaces and service do not exist.

- [ ] **Step 3: Add external service interfaces**

Create interfaces:

```ts
export interface TelegramDownloadedFile {
  filename: string;
  mimeType: string | null;
  buffer: Buffer;
}

export interface TelegramFileDownloadService {
  download(fileId: string): Promise<TelegramDownloadedFile>;
}
```

```ts
export interface ConvertedAudioFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface AudioConversionService {
  convertForTranscription(input: TelegramDownloadedFile): Promise<ConvertedAudioFile>;
}
```

```ts
export interface AudioTranscriptionService {
  transcribe(file: ConvertedAudioFile): Promise<string>;
}
```

Each file must export its own `Symbol.for(...)` service id.

- [ ] **Step 4: Add worker interface**

Create `src/application/interfaces/voice/VoiceMessageWorker.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

export interface VoiceMessageWorker {
  start(): void;
  stop(): void;
  drainOnce(): Promise<void>;
}

export const VOICE_MESSAGE_WORKER_ID = Symbol.for(
  'VoiceMessageWorker'
) as ServiceIdentifier<VoiceMessageWorker>;
```

- [ ] **Step 5: Implement worker**

Create `DefaultVoiceMessageWorker.ts`.

Rules:

- Inject job repo, message service, file download, conversion, transcription, behavior pipeline, voice config, logger factory.
- `drainOnce()` claims up to `workerConcurrency` jobs and processes them with `Promise.all`.
- `start()` loops with `setTimeout` or equivalent poll loop; do not block process startup.
- `stop()` disables further polling.
- Backoff:

```ts
const backoffMsByAttempt = [30_000, 120_000, 600_000];
```

- On success, update message first, then call behavior pipeline, then mark job done.
- On cancellation, mark job cancelled and do not call behavior pipeline.
- On final failure, mark job failed and call `messages.markVoiceFailed(job.messageId)`.
- Log errors without throwing out of the loop.

- [ ] **Step 6: Bind worker and interfaces**

Bind `VOICE_MESSAGE_WORKER_ID` to `DefaultVoiceMessageWorker` in `container/application.ts`.

- [ ] **Step 7: Run worker tests**

Run:

```bash
pnpm test -- test/VoiceMessageWorker.test.ts
```

Expected: PASS.

---

## Task 7: External Services

**Files:**
- Create: `src/infrastructure/external/TelegramFileDownloadService.ts`
- Create: `src/infrastructure/external/FfmpegAudioConversionService.ts`
- Create: `src/infrastructure/external/OpenAIAudioTranscriptionService.ts`
- Modify: `src/container/application.ts`
- Test: `test/VoiceExternalServices.test.ts`

- [ ] **Step 1: Write failing external service tests**

Use mocks for `grammy`, `child_process`, and `openai` where practical.

Test:

- Telegram downloader uses bot token and file id to return bytes.
- ffmpeg conversion writes temp input/output and calls `ffmpeg` through a safe argv API, not shell string composition.
- OpenAI transcription calls `audio.transcriptions.create` with configured model and returns text.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test -- test/VoiceExternalServices.test.ts
```

Expected: FAIL because services do not exist.

- [ ] **Step 3: Implement Telegram file download**

Implementation guidance:

- Use `envService.env.BOT_TOKEN`.
- Use grammy `Api` or the existing bot API pattern without launching polling.
- Get file metadata by `fileId`.
- Download file bytes from Telegram file endpoint.
- Return `{ filename, mimeType, buffer }`.
- Keep HTTP/network code in this infrastructure class.

- [ ] **Step 4: Implement ffmpeg conversion**

Implementation guidance:

- Use `node:child_process` `spawn` or `execFile`, not shell command strings.
- Use temp files in `os.tmpdir()`.
- Convert to `webm` or `mp3`.
- Clean temp files in `finally`.
- Return buffer and MIME type.
- Do not use `any`.

- [ ] **Step 5: Implement OpenAI transcription**

Implementation guidance:

- Use existing `OpenAI` import style from `ChatGPTService`.
- Use `client.audio.transcriptions.create`.
- Use configured `VOICE_TRANSCRIPTION_MODEL`.
- Convert buffer into a file upload accepted by the OpenAI SDK.
- Return trimmed text.

- [ ] **Step 6: Bind external services**

Bind each interface to its infrastructure implementation in `src/container/application.ts`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm test -- test/VoiceExternalServices.test.ts
```

Expected: PASS.

---

## Task 8: Telegram Voice Routing

**Files:**
- Modify: `src/view/telegram/routes.ts`
- Modify: `src/view/telegram/MainService.ts`
- Test: `test/TelegramVoiceRouting.test.ts`
- Test: `test/MainService.test.ts`

- [ ] **Step 1: Write failing routing tests**

Add tests proving:

- `routes.ts` registers `message:voice`.
- Voice handler calls `actions.processVoiceMessage`.
- `MainService` ignores admin chat voice messages.
- `MainService` ignores non-approved chat voice messages.
- Approved chat voice messages call `VoiceMessageService.enqueue`.
- Voice handling does not call `behaviorPipeline.handleStoredMessage`.

- [ ] **Step 2: Run routing tests to verify they fail**

Run:

```bash
pnpm test -- test/TelegramVoiceRouting.test.ts test/MainService.test.ts
```

Expected: FAIL because voice route/action does not exist.

- [ ] **Step 3: Extend route actions**

Modify `src/view/telegram/routes.ts` `Actions`:

```ts
processVoiceMessage: (ctx: BotContext) => Promise<void>;
```

Register:

```ts
bot.on('message:voice', async (ctx) => {
  await actions.processVoiceMessage(ctx);
});
```

- [ ] **Step 4: Inject and call voice service in MainService**

Modify constructor to inject `VOICE_MESSAGE_SERVICE_ID`.

Add `handleVoiceMessage(ctx: BotContext): Promise<void>`:

- Same chat id assertion as text.
- Same admin-chat ignore.
- Same approval check.
- Extract message context.
- Read `ctx.message.voice.file_id`, `duration`, `ctx.message.message_id`.
- Build app input object.
- Call `voiceMessageService.enqueue`.
- Log `queued` or rejected result.
- Do not call trigger or behavior pipeline here.

- [ ] **Step 5: Run routing tests**

Run:

```bash
pnpm test -- test/TelegramVoiceRouting.test.ts test/MainService.test.ts
```

Expected: PASS.

---

## Task 9: Worker Entrypoint And Build Wiring

**Files:**
- Create: `src/audio-worker.ts`
- Modify: `rsbuild.config.ts`
- Modify: `package.json`
- Test: `test/container.behavior.test.ts`

- [ ] **Step 1: Write failing container/build test**

Add to `test/container.behavior.test.ts`:

```ts
import {
  VOICE_MESSAGE_WORKER_ID,
  type VoiceMessageWorker,
} from '../src/application/interfaces/voice/VoiceMessageWorker';

it('resolves the voice message worker', () => {
  const worker = container.get<VoiceMessageWorker>(VOICE_MESSAGE_WORKER_ID);
  expect(worker).toBeTruthy();
});
```

- [ ] **Step 2: Run container test to verify it fails**

Run:

```bash
pnpm test -- test/container.behavior.test.ts
```

Expected: FAIL until bindings are complete.

- [ ] **Step 3: Add worker entrypoint**

Create `src/audio-worker.ts`:

```ts
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from './application/interfaces/logging/LoggerFactory';
import {
  VOICE_MESSAGE_WORKER_ID,
  type VoiceMessageWorker,
} from './application/interfaces/voice/VoiceMessageWorker';
import { container } from './container';

const loggerFactory = container.get<LoggerFactory>(LOGGER_FACTORY_ID);
const logger = loggerFactory.create('audio-worker');
const worker = container.get<VoiceMessageWorker>(VOICE_MESSAGE_WORKER_ID);

logger.info('Starting voice worker');
worker.start();

function shutdown(reason: string): void {
  logger.info(`${reason} received`);
  worker.stop();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
```

- [ ] **Step 4: Add RSBuild entry**

Modify `rsbuild.config.ts`. The entry map is nested under `source.entry` (not top-level) — add the one new line:

```ts
source: {
  entry: {
    index: './src/index.ts',
    'manual-job': './src/manual-job.ts',
    migrate: './src/migrate.ts',
    'audio-worker': './src/audio-worker.ts',
  },
  // ...existing decorators config stays
},
```

- [ ] **Step 5: Add package script**

Modify `package.json`:

```json
"audio-worker": "node dist/audio-worker.js"
```

Do not change `pnpm-lock.yaml` manually.

- [ ] **Step 6: Run container and build checks**

Run:

```bash
pnpm test -- test/container.behavior.test.ts
pnpm build
```

Expected: PASS and `dist/audio-worker.js` exists.

---

## Task 10: Docker Runtime Updates

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`

> **Starting point (verify before editing):** The Dockerfile is multi-stage `base → deps → build → runtime`. It **already uses pnpm** (`npm i -g pnpm@11.4.0`, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm prune --prod`) — there is NO `npm ci` / `package-lock.json` to "fix". The runtime stage currently generates an entrypoint with an inline `RUN echo '...' > /app/entrypoint.sh` that hardcodes `exec node dist/index.js`, and launches via `CMD ["/app/entrypoint.sh"]` with **no `ENTRYPOINT`**. `docker-compose.yml` defines `db` (alpine holding the `./data` volume) + `app` (build `target: runtime`, `env_file: .env`, `./data` mount, `depends_on: db`). `docker-compose.dev.yml` overrides `app` to `target: deps` + `command: pnpm dev` with source bind-mounts.

- [ ] **Step 1: Install ffmpeg in the runtime stage**

In the `FROM base AS runtime` stage, before `COPY --from=build /app /app`, add:

```dockerfile
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*
```

Do not touch the `deps`/`build` stages' package-manager commands — they are already correct.

- [ ] **Step 2: Make the launch command-aware (ENTRYPOINT + CMD)**

Change the generated entrypoint's last line from `exec node dist/index.js` to `exec "$@"`, e.g. the inline script becomes:

```sh
#!/bin/sh
set -e
if [ ! -f /data/memory.db ] || ! node dist/migrate.js check 2>/dev/null; then
  echo "Running migrations..."
  node dist/migrate.js up
else
  echo "Migrations already applied, skipping"
fi
echo "Starting: $*"
exec "$@"
```

Then **replace** `CMD ["/app/entrypoint.sh"]` with BOTH:

```dockerfile
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

This is the critical change: without converting the script to `ENTRYPOINT`, a `command:`/`CMD` override (the worker) would replace the script entirely and skip migrations. With `ENTRYPOINT` fixed, the default `CMD` runs the bot, and a worker container only overrides the command (`node dist/audio-worker.js`) while still passing through the migration gate.

- [ ] **Step 3: Add the `worker` service to `docker-compose.yml`**

Add a second service that reuses the same image/target and the shared `./data` volume:

```yaml
  worker:
    build:
      context: .
      target: runtime
    env_file:
      - .env
    environment:
      DATABASE_URL: file:///data/memory.db
      NODE_ENV: production
    command: ["node", "dist/audio-worker.js"]
    volumes:
      - ./data:/data
    depends_on:
      - db
      - app
    restart: unless-stopped
```

> **First-boot migration ordering:** both `app` and `worker` run the entrypoint migration gate. `depends_on` waits only for container *start*, not readiness, so on a fresh DB both could call `migrate.js up` concurrently (019's `CREATE TABLE` is not `IF NOT EXISTS`). Mitigation options, pick one and note it:
> - **Recommended:** add a one-shot `migrate` service (same image, `command: ["node","dist/migrate.js","up"]`, `restart: "no"`) and have both `app` and `worker` `depends_on: { migrate: { condition: service_completed_successfully } }`. This serializes migrations once; the entrypoint's idempotent `migrate.js check` then short-circuits in both long-running containers.
> - **Minimal:** rely on the WAL + `busy_timeout` hardening from Task 3 plus `restart: unless-stopped` so the loser self-heals on restart. Acceptable on a single-host Pi but logs a scary error on first boot.

- [ ] **Step 4: Add the `worker` override to `docker-compose.dev.yml`**

Mirror the existing dev `app` override so the worker also runs in watch/dev mode against the `deps` target:

```yaml
  worker:
    build:
      context: .
      target: deps
    command: sh -c "rsbuild build && node dist/audio-worker.js"
    environment:
      DATABASE_URL: file:///data/memory.db
      NODE_ENV: development
    volumes:
      - ./src:/app/src
      - ./prompts:/app/prompts
      - ./migrations:/app/migrations
      - ./rsbuild.config.ts:/app/rsbuild.config.ts
      - ./tsconfig.json:/app/tsconfig.json
    restart: unless-stopped
```

Match whatever watch command the existing dev `app` uses; keep both services on the same source mounts so a rebuild covers bot and worker.

- [ ] **Step 5: Keep one-image / two-command model**

Do not add `supervisord`. The same `runtime` image runs either `node dist/index.js` (default `CMD`) or `node dist/audio-worker.js` (override). Both compose services share the same `./data` mount.

- [ ] **Step 6: Build Docker image**

Run:

```bash
docker build -t carl-bot:voice .
```

Expected: image builds and the runtime layer installs `ffmpeg`.

If Docker is unavailable locally, record that verification could not be run and continue with `pnpm build`.

---

## Task 11: End-To-End Voice Job Integration

**Files:**
- Test: `test/VoiceMessageWorker.test.ts`
- Test: `test/SQLiteVoiceTranscriptionJobRepository.test.ts`
- Test: `test/BehaviorPipeline.test.ts`

- [ ] **Step 1: Add integration-style mocked flow test**

Add one test that uses real SQLite repositories and mocked external services:

1. Create pending voice message + job.
2. Claim/process through `DefaultVoiceMessageWorker.drainOnce`.
3. Assert message is ready and content is transcript.
4. Assert job is done.
5. Assert behavior pipeline receives the ready `StoredBehaviorMessage`.

- [ ] **Step 2: Run the integration flow test**

Run:

```bash
pnpm test -- test/VoiceMessageWorker.test.ts test/SQLiteVoiceTranscriptionJobRepository.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run broader behavior tests**

Run:

```bash
pnpm test -- test/BehaviorPipeline.test.ts test/BehaviorContextAssembler.test.ts test/MainService.test.ts
```

Expected: PASS.

---

## Task 12: Formatting, Linting, Typecheck, Full Test

**Files:**
- All changed implementation files.

- [ ] **Step 1: Run auto-fix commands**

Run:

```bash
pnpm lint:fix
pnpm format:fix
```

Expected: commands complete. They may modify formatting.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm type:check
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Verify Docker image if Docker is available**

Run:

```bash
docker build -t carl-bot:voice .
```

Expected: PASS.

- [ ] **Step 6: Inspect git status**

Run:

```bash
git status --short
```

Expected: implementation files are changed; `docs/superpowers/*` remains untracked or ignored and must not be committed.

---

## Manual Runtime Check

Use after automated tests pass.

1. Start the bot process:

```bash
pnpm start
```

2. In another process, start the worker:

```bash
pnpm audio-worker
```

3. Send a short voice message in an approved non-admin chat.

4. Check SQLite:

```sql
SELECT id, content, source_type, processing_status
FROM messages
ORDER BY id DESC
LIMIT 5;

SELECT id, message_id, status, attempts, last_error
FROM voice_transcription_jobs
ORDER BY id DESC
LIMIT 5;
```

Expected:

- Initial message row is `source_type = 'voice'`, `processing_status = 'pending'`.
- After worker finishes, same message row is `processing_status = 'ready'`.
- `content` starts with `[voice]`.
- Job status is `done`.
- Carl responds if the transcript matches existing trigger logic.

---

## Implementation Notes

- Do not add a generic queue framework.
- Do not call OpenAI or ffmpeg from `MainService`.
- Do not let pending placeholders into history reads.
- Do not store raw audio permanently.
- Use `void` for intentional fire-and-forget only when the failure path is logged.
- Prefer pattern matching style where it fits existing code.
- Keep comments sparse and only where the queue locking or retry logic needs orientation.
