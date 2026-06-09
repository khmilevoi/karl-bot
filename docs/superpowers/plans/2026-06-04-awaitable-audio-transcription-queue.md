# Awaitable Audio Transcription Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current fire-and-forget voice message queue API with an awaitable transcription service so callers can use `const text = await transcriptionService.transcribe(audioFile)` while audio work still runs in the separate worker process.

**Architecture:** Keep the dedicated `audio-worker` process. The bot process creates an SQLite transcription job and polls the database until the worker writes a terminal result. The worker only downloads/converts/transcribes audio and writes job status/result; normal message storage and behavior pipeline execution move back to the bot process after `transcribe()` resolves.

**Tech Stack:** TypeScript, Inversify, SQLite, grammy, OpenAI Audio API, ffmpeg, Vitest, RSBuild.

---

## Design Decision

Use SQLite polling, not sockets.

Reasons:

- Bot and worker are separate processes, so an in-memory `Promise` resolver map cannot work.
- SQLite is already the durable source of truth for queue status.
- Socket events can be lost across process restarts and still need a database fallback.
- Polling is enough for the current single-host Raspberry Pi deployment.

The new flow should look like this at the call site:

```ts
const text =
  sourceType === 'audio'
    ? await transcriptionService.transcribe(audioFile)
    : inputText;
```

Use `transcribe`, not the typo `transcripe`, in code.

## File Structure

### Create

- `migrations/020_audio_transcription_jobs.up.sql` - result-bearing audio transcription queue.
- `migrations/020_audio_transcription_jobs.down.sql` - drops the new queue table.
- `src/domain/voice/AudioTranscriptionJobTypes.ts` - domain types for awaitable transcription jobs.
- `src/domain/repositories/AudioTranscriptionJobRepository.ts` - queue repository interface.
- `src/application/interfaces/voice/QueuedAudioTranscriptionService.ts` - high-level awaitable service used by Telegram/application code.
- `src/application/interfaces/voice/AudioTranscriptionWorker.ts` - worker interface.
- `src/application/use-cases/voice/DefaultQueuedAudioTranscriptionService.ts` - creates jobs and polls for result.
- `src/application/use-cases/voice/DefaultAudioTranscriptionWorker.ts` - worker loop for the new result-bearing queue.
- `src/infrastructure/persistence/sqlite/SQLiteAudioTranscriptionJobRepository.ts` - SQLite repository implementation.
- `test/AudioTranscriptionJobMigration020.test.ts`
- `test/SQLiteAudioTranscriptionJobRepository.test.ts`
- `test/QueuedAudioTranscriptionService.test.ts`
- `test/AudioTranscriptionWorker.test.ts`

### Modify

- `src/application/voice/VoiceConfig.ts` - add wait timeout and result polling interval config.
- `src/application/interfaces/env/EnvService.ts` - expose new config fields.
- `src/infrastructure/config/envSchema.ts` - parse new env vars.
- `src/infrastructure/config/DefaultEnvService.ts` - production defaults.
- `src/infrastructure/config/TestEnvService.ts` - test defaults.
- `src/container/application.ts` - bind new service, worker, and repository.
- `src/container/audio-worker.ts` - bind new worker/repository for worker-only container if this split container stays.
- `src/audio-worker.ts` - resolve `AudioTranscriptionWorker` instead of the old message worker.
- `src/view/telegram/MainService.ts` - await transcription, then store/process a normal ready user message.
- `src/application/use-cases/messages/MessageFactory.ts` - add helper to create a user message from explicit content/source type.
- `test/TelegramVoiceRouting.test.ts`
- `test/MainService.test.ts`
- Existing voice tests: update or remove old `VoiceMessageService`/`VoiceMessageWorker` expectations.

### Leave In Place For Compatibility

- Existing migration `019_voice_messages_and_jobs` and table `voice_transcription_jobs`.

Do not rewrite migration 019. Migration 020 adds a new `audio_transcription_jobs` table. After the new path is working, old voice queue code can be deleted, but the old table can remain harmlessly unused until a later cleanup migration.

---

## Task 1: Add Result-Bearing Queue Schema

**Files:**
- Create: `migrations/020_audio_transcription_jobs.up.sql`
- Create: `migrations/020_audio_transcription_jobs.down.sql`
- Create: `src/domain/voice/AudioTranscriptionJobTypes.ts`
- Test: `test/AudioTranscriptionJobMigration020.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `test/AudioTranscriptionJobMigration020.test.ts` and assert that after `migrateUp()` the DB has `audio_transcription_jobs` with:

```ts
expect(columns).toEqual(
  expect.arrayContaining([
    'id',
    'telegram_file_id',
    'status',
    'attempts',
    'available_at',
    'locked_until',
    'result_text',
    'last_error',
    'created_at',
    'updated_at',
  ])
);
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
pnpm test -- test/AudioTranscriptionJobMigration020.test.ts
```

Expected: FAIL because migration 020 does not exist.

- [ ] **Step 3: Add domain types**

Create `src/domain/voice/AudioTranscriptionJobTypes.ts`:

```ts
export type AudioTranscriptionJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface AudioTranscriptionJob {
  id: number;
  telegramFileId: string;
  status: AudioTranscriptionJobStatus;
  attempts: number;
  availableAt: string;
  lockedUntil: string | null;
  resultText: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewAudioTranscriptionJob {
  telegramFileId: string;
  availableAt: string;
}
```

- [ ] **Step 4: Add migration SQL**

Create `migrations/020_audio_transcription_jobs.up.sql`:

```sql
BEGIN TRANSACTION;

CREATE TABLE audio_transcription_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_file_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_until TEXT,
  result_text TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_audio_transcription_jobs_pick
  ON audio_transcription_jobs(status, available_at, locked_until);

COMMIT;
```

Create `migrations/020_audio_transcription_jobs.down.sql`:

```sql
BEGIN TRANSACTION;

DROP INDEX IF EXISTS idx_audio_transcription_jobs_pick;
DROP TABLE IF EXISTS audio_transcription_jobs;

COMMIT;
```

- [ ] **Step 5: Run migration test**

Run:

```bash
pnpm test -- test/AudioTranscriptionJobMigration020.test.ts
```

Expected: PASS.

---

## Task 2: Add Audio Transcription Job Repository

**Files:**
- Create: `src/domain/repositories/AudioTranscriptionJobRepository.ts`
- Create: `src/infrastructure/persistence/sqlite/SQLiteAudioTranscriptionJobRepository.ts`
- Test: `test/SQLiteAudioTranscriptionJobRepository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Cover:

- `create()` inserts a queued job.
- `claimNext()` claims the oldest due job and increments attempts.
- stale `running` jobs can be reclaimed after `locked_until`.
- `markDone(jobId, text, now)` stores `result_text` and terminal status.
- `markFailed()` stores `last_error`.
- `findById()` returns terminal result for polling.

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm test -- test/SQLiteAudioTranscriptionJobRepository.test.ts
```

Expected: FAIL because repository does not exist.

- [ ] **Step 3: Add repository interface**

Create `src/domain/repositories/AudioTranscriptionJobRepository.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';
import type {
  AudioTranscriptionJob,
  NewAudioTranscriptionJob,
} from '@/domain/voice/AudioTranscriptionJobTypes';

export interface AudioTranscriptionJobRepository {
  create(job: NewAudioTranscriptionJob): Promise<AudioTranscriptionJob>;
  findById(jobId: number): Promise<AudioTranscriptionJob | null>;
  claimNext(now: string, lockedUntil: string): Promise<AudioTranscriptionJob | null>;
  markDone(jobId: number, resultText: string, now: string): Promise<void>;
  requeue(jobId: number, availableAt: string, lastError: string, now: string): Promise<void>;
  markFailed(jobId: number, lastError: string, now: string): Promise<void>;
  markCancelled(jobId: number, reason: string, now: string): Promise<void>;
}

export const AUDIO_TRANSCRIPTION_JOB_REPOSITORY_ID = Symbol.for(
  'AudioTranscriptionJobRepository'
) as ServiceIdentifier<AudioTranscriptionJobRepository>;
```

- [ ] **Step 4: Implement SQLite repository**

Create `SQLiteAudioTranscriptionJobRepository.ts` using the same transaction/claim style as `SQLiteVoiceTranscriptionJobRepository`.

Important rules:

- `claimNext()` must use `BEGIN IMMEDIATE`.
- `claimNext()` picks `(queued AND available_at <= now)` or stale `(running AND locked_until <= now)`.
- `markDone()` must set `status = 'done'`, `result_text = ?`, `locked_until = NULL`, `updated_at = ?`.
- `findById()` is the polling read used by the bot process.

- [ ] **Step 5: Run repository test**

Run:

```bash
pnpm test -- test/SQLiteAudioTranscriptionJobRepository.test.ts
```

Expected: PASS.

---

## Task 3: Add Awaitable Transcription Service

**Files:**
- Create: `src/application/interfaces/voice/QueuedAudioTranscriptionService.ts`
- Create: `src/application/use-cases/voice/DefaultQueuedAudioTranscriptionService.ts`
- Modify: `src/application/voice/VoiceConfig.ts`
- Modify: `src/infrastructure/config/envSchema.ts`
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`
- Test: `test/QueuedAudioTranscriptionService.test.ts`

- [ ] **Step 1: Write failing service tests**

Cover:

- creates a queued job and resolves when `findById()` returns `done` with `resultText`.
- rejects when terminal status is `failed`.
- rejects when terminal status is `cancelled`.
- rejects on timeout if worker never finishes.
- rejects immediately when `telegramFileId` is empty.
- rejects when duration exceeds `maxDurationSeconds`.

Use fake timers for polling:

```ts
vi.useFakeTimers();
const promise = service.transcribe({ telegramFileId: 'file-id' });
await vi.advanceTimersByTimeAsync(100);
await expect(promise).resolves.toBe('hello');
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm test -- test/QueuedAudioTranscriptionService.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Add service interface**

Create `QueuedAudioTranscriptionService.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

export interface AudioTranscriptionInput {
  telegramFileId: string;
  durationSeconds?: number;
}

export interface QueuedAudioTranscriptionService {
  transcribe(input: AudioTranscriptionInput): Promise<string>;
}

export const QUEUED_AUDIO_TRANSCRIPTION_SERVICE_ID = Symbol.for(
  'QueuedAudioTranscriptionService'
) as ServiceIdentifier<QueuedAudioTranscriptionService>;
```

- [ ] **Step 4: Extend voice config**

Add to `VoiceConfig`:

```ts
transcriptionWaitTimeoutMs: number;
transcriptionResultPollIntervalMs: number;
```

Add env values:

- `VOICE_TRANSCRIPTION_WAIT_TIMEOUT_MS`, default `120000`
- `VOICE_TRANSCRIPTION_RESULT_POLL_INTERVAL_MS`, default `500`

- [ ] **Step 5: Implement polling service**

`DefaultQueuedAudioTranscriptionService.transcribe()`:

1. Validate `telegramFileId`.
2. Validate duration against `maxDurationSeconds`.
3. Create `audio_transcription_jobs` row with `availableAt = now`.
4. Poll `repo.findById(job.id)` every `transcriptionResultPollIntervalMs`.
5. Resolve with trimmed `resultText` on `done`.
6. Reject on `failed`, `cancelled`, missing job, empty result, or timeout.

Keep this service free of Telegram, ffmpeg, and OpenAI SDK details.

- [ ] **Step 6: Run service tests**

Run:

```bash
pnpm test -- test/QueuedAudioTranscriptionService.test.ts
```

Expected: PASS.

---

## Task 4: Replace Worker Responsibility

**Files:**
- Create: `src/application/interfaces/voice/AudioTranscriptionWorker.ts`
- Create: `src/application/use-cases/voice/DefaultAudioTranscriptionWorker.ts`
- Modify: `src/audio-worker.ts`
- Modify: `src/container/application.ts`
- Modify: `src/container/audio-worker.ts`
- Test: `test/AudioTranscriptionWorker.test.ts`

- [ ] **Step 1: Write failing worker tests**

Cover:

- successful job claims, downloads, converts, transcribes, and calls `repo.markDone(job.id, text, now)`.
- empty transcript is treated as a retryable failure.
- transient error below max attempts calls `requeue`.
- final error at max attempts calls `markFailed`.
- `drainOnce()` returns cleanly when no jobs exist.

Do not assert any `MessageService` or `BehaviorPipeline` calls. The new worker must not know about messages or behavior.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm test -- test/AudioTranscriptionWorker.test.ts
```

Expected: FAIL because worker does not exist.

- [ ] **Step 3: Add worker interface**

Create `AudioTranscriptionWorker.ts` with the same shape as the current worker:

```ts
import type { ServiceIdentifier } from 'inversify';

export interface AudioTranscriptionWorker {
  start(): void;
  stop(): void;
  drainOnce(): Promise<void>;
}

export const AUDIO_TRANSCRIPTION_WORKER_ID = Symbol.for(
  'AudioTranscriptionWorker'
) as ServiceIdentifier<AudioTranscriptionWorker>;
```

- [ ] **Step 4: Implement worker**

`DefaultAudioTranscriptionWorker` injects:

- `AudioTranscriptionJobRepository`
- `TelegramFileDownloadService`
- `AudioConversionService`
- existing low-level `AudioTranscriptionService`
- `VoiceConfig`
- `LoggerFactory`

Processing:

```ts
const downloaded = await this.fileDownload.download(job.telegramFileId);
const converted = await this.audioConversion.convertForTranscription(downloaded);
const text = (await this.transcription.transcribe(converted)).trim();
if (!text) throw new Error('Empty transcript returned');
await this.jobRepo.markDone(job.id, text, now);
```

Retry/backoff rules should match the old worker.

- [ ] **Step 5: Update worker entrypoint**

Modify `src/audio-worker.ts` to resolve `AUDIO_TRANSCRIPTION_WORKER_ID`.

Keep the script name `audio-worker` for deployment compatibility.

- [ ] **Step 6: Run worker tests**

Run:

```bash
pnpm test -- test/AudioTranscriptionWorker.test.ts
```

Expected: PASS.

---

## Task 5: Switch Telegram Voice Flow To Awaited Text

**Files:**
- Modify: `src/view/telegram/MainService.ts`
- Modify: `src/application/use-cases/messages/MessageFactory.ts`
- Test: `test/TelegramVoiceRouting.test.ts`
- Test: `test/MainService.test.ts`

- [ ] **Step 1: Write failing MainService tests**

Update voice tests to assert:

- approved voice message calls `queuedAudioTranscriptionService.transcribe(...)`.
- after transcription resolves, `messages.addMessage()` receives content equal to transcript.
- stored message has `sourceType = 'voice'`, `processingStatus = 'ready'`.
- behavior pipeline is called after the message is stored.
- admin and non-approved chat voice messages do not call transcription.
- transcription failure logs/returns without storing a message.

This replaces the old expectation that voice handler only enqueues and does not call behavior pipeline.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm test -- test/TelegramVoiceRouting.test.ts test/MainService.test.ts
```

Expected: FAIL because MainService still uses `VoiceMessageService.enqueue()`.

- [ ] **Step 3: Add explicit-content message factory helper**

Add a helper such as:

```ts
static fromUserContent(
  ctx: Context,
  meta: MessageContext,
  content: string,
  sourceType: MessageSourceType
): StoredMessage
```

It should reuse the existing `fromUser()` metadata mapping and set:

```ts
content,
sourceType,
processingStatus: 'ready'
```

- [ ] **Step 4: Factor common stored-message processing**

In `MainService`, extract the common part of `handleMessage()` after message creation:

```ts
private async processReadyUserMessage(
  ctx: BotContext,
  userMsg: StoredMessage
): Promise<void>
```

It should:

1. `messages.addMessage(userMsg)`
2. build `StoredBehaviorMessage`
3. run trigger pipeline using `userMsg.content`
4. call `behaviorPipeline.handleStoredMessage(...)`

Then `handleMessage()` and `handleVoiceMessage()` both call this helper.

- [ ] **Step 5: Implement awaited voice handler**

In `handleVoiceMessage()`:

```ts
const text = await this.queuedAudioTranscriptionService.transcribe({
  telegramFileId: voice.file_id,
  durationSeconds: voice.duration,
});

const userMsg = MessageFactory.fromUserContent(ctx, meta, text, 'voice');
await this.processReadyUserMessage(ctx, userMsg);
```

Handle rejection by logging the error and not writing a message.

- [ ] **Step 6: Run MainService tests**

Run:

```bash
pnpm test -- test/TelegramVoiceRouting.test.ts test/MainService.test.ts
```

Expected: PASS.

---

## Task 6: Update DI Bindings And Remove Old Application Path

**Files:**
- Modify: `src/container/application.ts`
- Modify: `src/container/audio-worker.ts`
- Modify: old tests referencing `VoiceMessageService` / `DefaultVoiceMessageWorker`

- [ ] **Step 1: Bind new repository/service/worker**

Bind:

```ts
container
  .bind<AudioTranscriptionJobRepository>(AUDIO_TRANSCRIPTION_JOB_REPOSITORY_ID)
  .to(SQLiteAudioTranscriptionJobRepository)
  .inSingletonScope();

container
  .bind<QueuedAudioTranscriptionService>(QUEUED_AUDIO_TRANSCRIPTION_SERVICE_ID)
  .to(DefaultQueuedAudioTranscriptionService)
  .inSingletonScope();

container
  .bind<AudioTranscriptionWorker>(AUDIO_TRANSCRIPTION_WORKER_ID)
  .to(DefaultAudioTranscriptionWorker)
  .inSingletonScope();
```

- [ ] **Step 2: Remove old voice message service injection from MainService**

Replace `VOICE_MESSAGE_SERVICE_ID` injection with `QUEUED_AUDIO_TRANSCRIPTION_SERVICE_ID`.

- [ ] **Step 3: Decide old code cleanup**

After tests pass, delete old unused files if no references remain:

- `src/application/interfaces/voice/VoiceMessageService.ts`
- `src/application/interfaces/voice/VoiceMessageWorker.ts`
- `src/application/use-cases/voice/DefaultVoiceMessageService.ts`
- `src/application/use-cases/voice/DefaultVoiceMessageWorker.ts`
- `src/domain/repositories/VoiceTranscriptionJobRepository.ts`
- `src/infrastructure/persistence/sqlite/SQLiteVoiceTranscriptionJobRepository.ts`

Keep migration 019 and the old table for DB compatibility.

- [ ] **Step 4: Verify no stale references**

Run:

```bash
rg "VoiceMessageService|DefaultVoiceMessageService|VoiceMessageWorker|DefaultVoiceMessageWorker|VoiceTranscriptionJobRepository" src test
```

Expected: no references, unless intentionally kept in migration/history docs.

---

## Task 7: Focused And Full Verification

**Files:**
- All changed source and test files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test -- test/AudioTranscriptionJobMigration020.test.ts test/SQLiteAudioTranscriptionJobRepository.test.ts test/QueuedAudioTranscriptionService.test.ts test/AudioTranscriptionWorker.test.ts test/TelegramVoiceRouting.test.ts test/MainService.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run fix commands**

Run:

```bash
pnpm lint:fix
pnpm format:fix
```

Expected: commands complete without manual cleanup, or report only actionable issues.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm type:check
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Build**

Run:

```bash
pnpm build
```

Expected: PASS and `dist/audio-worker.js` still exists.

---

## Manual Runtime Check

1. Start the bot process:

```bash
pnpm start
```

2. Start the worker process separately:

```bash
pnpm audio-worker
```

3. Send a short voice message in an approved non-admin chat.

4. Check SQLite:

```sql
SELECT id, telegram_file_id, status, attempts, result_text, last_error
FROM audio_transcription_jobs
ORDER BY id DESC
LIMIT 5;
```

Expected:

- A row appears as `queued`.
- Worker moves it to `running`, then `done`.
- `result_text` contains the transcript.
- Bot stores a ready `messages` row with `source_type = 'voice'`.
- Behavior pipeline runs after the transcript is stored.

## Risks And Notes

- Awaiting transcription means the voice update handler now waits for the worker. If the worker is down, the call fails by timeout.
- Message insertion happens after transcription resolves, so history ordering follows completion time, not queue creation time. If strict original message ordering becomes required, add a separate ordering field or a reserved message row in a follow-up.
- Do not solve this with sockets first. If sockets are added later for faster wakeup, keep DB polling as the correctness fallback.
- Do not call OpenAI, Telegram file download, or ffmpeg from `MainService`.
- Do not commit files under `docs/superpowers/`.
