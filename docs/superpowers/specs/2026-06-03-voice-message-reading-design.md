# Voice Message Reading Design

**Goal:** Let Carl read Telegram voice messages, store their transcript in the normal message history, and process audio work in a separate worker through a durable SQLite queue.

**Context:** The bot runs on a Raspberry Pi. There is no need for multi-host queue balancing. The queue must still be durable across process restarts and must keep audio conversion and OpenAI speech-to-text work out of the Telegram update handler.

## Requirements

- Voice messages must be accepted in approved non-admin chats.
- Voice messages must end up in the existing `messages` table as user messages.
- The stored message content must be the transcribed text, not the raw audio file.
- The Telegram update handler must not download, convert, or transcribe audio synchronously.
- Audio processing must run in a separate `audio-worker` process.
- Queue state must survive bot or worker restarts.
- The worker must limit concurrency to avoid overloading the Raspberry Pi.
- Failed jobs must retry with backoff and eventually move to `failed`.
- The bot must not feed placeholder voice text into prompts while transcription is pending.
- If a chat reset deactivates a pending placeholder, the worker must not resurrect it.

## Non-Goals

- Do not store raw audio files permanently.
- Do not add Redis, BullMQ, RabbitMQ, or another external broker.
- Do not add multi-host queue balancing.
- Do not send raw audio directly to the behavior model.
- Do not implement realtime microphone streaming.

## Recommended Approach

Use a SQLite-backed job queue and a dedicated `audio-worker` process.

The main bot creates a placeholder `messages` row to reserve the correct history order, then enqueues a `voice_transcription_jobs` row. The placeholder is not visible to prompt/history queries until the worker finishes. The worker downloads the Telegram file, converts it if needed, sends it to OpenAI speech-to-text, updates the placeholder message with the transcript, marks it ready, and then calls the existing behavior pipeline.

## Architectural Fit

Implement the feature using the same Clean Architecture and DI boundaries as the rest of the project.

Layer responsibilities:

- `src/view/telegram`: Telegram-specific routing and context mapping only. `MainService` and `routes.ts` must not call OpenAI, run `ffmpeg`, or write queue SQL directly.
- `src/application/interfaces`: Interfaces for voice processing, queueing, audio conversion, transcription, and Telegram file download.
- `src/application/use-cases`: Voice use cases and worker orchestration. This layer coordinates repositories/services through interfaces and owns business rules such as enqueueing, retry handling, cancellation checks, and pipeline handoff.
- `src/domain`: Shared domain types for voice jobs, message source type, processing status, and queue statuses when those types are not infrastructure-specific.
- `src/infrastructure/persistence/sqlite`: SQLite implementations of message status updates and the voice job queue repository.
- `src/infrastructure/external`: OpenAI transcription implementation, `ffmpeg` conversion implementation, and Telegram file download implementation.
- `src/container`: Inversify bindings for all new interfaces and config objects.

Boundary rules:

- New services must be interface-first with Symbol-based service registration.
- The Telegram handler should call one application use case such as `VoiceMessageService.enqueueFromTelegram(ctxData)`.
- The worker process should resolve one application service such as `VoiceMessageWorker` from the container and call its start/drain method.
- OpenAI SDK usage must stay in infrastructure, not in application or view code.
- `ffmpeg` process execution must stay behind an `AudioConversionService` interface.
- SQLite access must stay behind repository interfaces and `DbProvider`.
- Placeholder message creation and job enqueueing should be atomic from the application perspective. Prefer a repository method or transaction-aware service that inserts the pending message and job together.
- Existing text-message behavior should remain unchanged except where repository reads need to filter `processing_status = 'ready'`.
- Avoid adding a generic queue abstraction broader than this feature needs. A focused `VoiceTranscriptionJobRepository` is enough for this scope.
- Tests should mock application interfaces for use-case tests and reserve SQLite integration tests for repository/migration behavior.

## Data Model

Add message metadata so pending voice placeholders can exist without leaking into AI context:

```sql
ALTER TABLE messages ADD COLUMN source_type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'ready';
```

Expected values:

- `source_type`: `text`, `voice`
- `processing_status`: `ready`, `pending`, `failed`

Repository reads used by prompts, behavior, summaries, and history must only return active ready messages:

```sql
WHERE m.is_active = 1 AND m.processing_status = 'ready'
```

Create the queue table:

```sql
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
```

Expected job statuses:

- `queued`
- `running`
- `done`
- `failed`
- `cancelled`

## Runtime Flow

### Bot Process

1. `routes.ts` registers `bot.on('message:voice')`.
2. `MainService` applies the same admin-chat and approved-chat checks as text messages.
3. The handler extracts normal message context using the existing context extractor.
4. The handler inserts a user message with:
   - `source_type = 'voice'`
   - `processing_status = 'pending'`
   - `content = '[voice:pending]'`
5. The handler enqueues a voice transcription job with the stored message id and Telegram `file_id`.
6. The handler returns without calling the behavior pipeline.

### Worker Process

1. `audio-worker` bootstraps the same DI container but does not launch Telegram long polling.
2. The worker repeatedly claims due jobs from SQLite.
3. A claim moves a job from `queued` to `running`, increments attempts, and sets `locked_until`.
4. The worker downloads the Telegram file by `telegram_file_id`.
5. The worker converts Telegram voice audio to an OpenAI-supported upload format when needed.
6. The worker calls OpenAI speech-to-text.
7. The worker checks that the placeholder message is still active and pending.
8. If the message is still valid, the worker updates it:
   - `content = '[voice] ' || transcript`
   - `processing_status = 'ready'`
9. The worker builds `StoredBehaviorMessage` from the updated row and calls `behaviorPipeline.handleStoredMessage`.
10. The worker marks the job `done`.

## Docker And Deployment

The project already has a multi-stage Dockerfile. The voice feature should extend that Docker setup instead of requiring a separate manual runtime.

Required Docker changes:

- Add `ffmpeg` to the runtime image, because the worker needs it to convert Telegram OGG/Opus voice files before transcription.
- Keep `apt-get update` and `apt-get install` in the same `RUN` instruction and install with `--no-install-recommends`.
- Clean apt lists in the same layer after installing runtime packages.
- Add a package script for the worker, for example `pnpm audio-worker`.
- Build one image that can run either the bot or the worker.

Recommended container model:

- Do not run the bot process and voice worker in the same container through `supervisord`.
- Run two containers from the same image with different commands:
  - bot: `pnpm start`
  - worker: `pnpm audio-worker`
- Mount the same SQLite data directory into both containers.
- Set `VOICE_WORKER_CONCURRENCY=1` by default on Raspberry Pi.

If the Raspberry Pi deployment uses Docker Compose, model it as two services that share the same image, environment, and `/data` volume. If it uses systemd directly, keep two systemd units that run the two Docker commands separately.

## Queue Semantics

- Default worker concurrency should be `1`.
- Concurrency can be configured with `VOICE_WORKER_CONCURRENCY`.
- Jobs are claimed in oldest-first order by `available_at`, then `id`.
- Stale `running` jobs whose `locked_until` is in the past are claimable again.
- Retry backoff should be deterministic and small enough for chat use:
  - attempt 1: 30 seconds
  - attempt 2: 2 minutes
  - attempt 3: 10 minutes
- After `VOICE_WORKER_MAX_ATTEMPTS`, mark the job `failed` and set the message `processing_status = 'failed'`.
- On process startup, the worker should be able to resume queued and stale running jobs.

## Audio Handling

Telegram voice messages are expected to arrive as OGG/Opus. OpenAI speech-to-text file uploads support formats such as `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, and `webm`, with a 25 MB upload limit. The worker should convert unsupported Telegram audio to `webm`, `mp3`, or `wav` using `ffmpeg`.

The Raspberry Pi Docker runtime must include `ffmpeg`. Local tests should mock conversion and transcription services instead of invoking real `ffmpeg` or OpenAI.

## OpenAI Speech-To-Text

Use the Audio API transcription endpoint rather than passing audio directly to the behavior model.

Recommended model defaults:

- Default: `gpt-4o-mini-transcribe`
- Optional quality escalation: `gpt-4o-transcribe`

The transcription service should return plain text. Empty or whitespace-only transcripts should be treated as a failed job unless the API returns an explicit useful result.

## Behavior Pipeline Integration

Voice messages should behave like text messages after transcription:

- They are saved as user messages in `messages`.
- They can trigger direct response logic if the transcript mentions Carl, replies to Carl, or otherwise matches existing triggers.
- They participate in history, summaries, profiles, and state evolution once marked `ready`.

The pipeline should use the transcript content, not the placeholder content.

## Reset And Cancellation

If a chat reset runs while a voice job is pending or running, the worker must not reactivate the placeholder after reset. Before finalizing a job, the worker must reload the message and confirm:

- `is_active = 1`
- `source_type = 'voice'`
- `processing_status = 'pending'`

If this check fails, mark the job `cancelled` and do not call the behavior pipeline.

## Configuration

Add environment/config values:

- `VOICE_WORKER_CONCURRENCY`, default `1`
- `VOICE_WORKER_POLL_INTERVAL_MS`, default `1000`
- `VOICE_WORKER_LOCK_MS`, default `300000`
- `VOICE_WORKER_MAX_ATTEMPTS`, default `3`
- `VOICE_TRANSCRIPTION_MODEL`, default `gpt-4o-mini-transcribe`
- `VOICE_MAX_DURATION_SECONDS`, default `120`

## Testing Strategy

Unit tests:

- Voice handler enqueues a job and does not call behavior pipeline.
- Voice handler creates a pending voice placeholder in `messages`.
- Message repository excludes `processing_status = 'pending'` from history reads.
- Worker claims queued jobs and respects lock/backoff behavior.
- Worker updates placeholder to ready after successful transcription.
- Worker calls behavior pipeline only after a successful update.
- Worker cancels a job if the placeholder became inactive.
- Worker marks failed after max attempts.

Integration tests:

- SQLite migration creates voice job table and message status columns.
- End-to-end voice job processing with mocked Telegram download, mocked conversion, and mocked OpenAI transcription.

Manual verification:

- Run `pnpm build`.
- Run `pnpm test`.
- Build the Docker image.
- Run bot and worker as separate containers or separate processes.
- Send a Telegram voice message in an approved chat.
- Confirm a pending job appears, then transitions to done.
- Confirm `messages.content` contains the transcript.
- Confirm Carl responds if the transcript triggers him.

## Source Notes

OpenAI speech-to-text docs currently describe the Audio API transcription endpoint for bounded audio file uploads and list supported upload formats and model options.
