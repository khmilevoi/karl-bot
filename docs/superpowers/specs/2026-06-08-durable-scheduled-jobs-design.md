# Durable Scheduled Jobs Design

**Date:** 2026-06-08

**Status:** Draft approved for planning (revised after brainstorm)

## Goal

Move scheduled job triggering out of the main bot process into a separate
`cron-worker`, make scheduling durable through the existing SQLite database, and
remove the `topic-of-day` feature completely.

## Background

The current app starts cron schedules inside the same process that handles the
Telegram bot, HTTP server, OpenAI calls, and other runtime work. That makes
scheduled callbacks vulnerable to event-loop stalls in the main process. Recent
logs showed `node-cron` missed executions with warnings about possible blocking
I/O or high CPU usage.

The codebase already exposes manual job execution over HTTP:

- `POST /jobs/:job`
- `POST /jobs/:job/all`

The new design keeps those endpoints as execution boundaries, but moves
scheduling and retry ownership to a dedicated process.

### What this design does and does not buy

Job **execution** stays synchronous inside `app` (the cron-worker only calls the
app's HTTP job API). So the value of this design is precisely:

- **Reliable triggering timing** — cron now lives in a process that is not
  competing with the Telegram bot / OpenAI work for the event loop.
- **Durable retry** of missed or failed scheduled slots — every due slot becomes
  a persisted row that survives restarts and is retried with backoff.

It does **not** increase job throughput or protect against a stalled `app` event
loop during the execution itself. If `app` stalls, the HTTP job call stalls; the
cron-worker recovers via timeout + retry/lock expiry, not by running the work
elsewhere. Making execution asynchronous is an explicit Non-Goal (see below).

### Timing roles: reconciliation vs node-cron

The cron-worker runs **both** `node-cron` callbacks and a periodic
reconciliation loop, with clearly separated responsibilities:

- **Reconciliation is the durability guarantee.** Even if a `node-cron` callback
  is missed (sleep, restart, stall), the reconciliation tick recomputes recent
  due slots and inserts any missing rows via `INSERT OR IGNORE`.
- **`node-cron` is best-effort precision.** It fires slots close to their exact
  scheduled time. A missed callback is never fatal because reconciliation backs
  it up.

## Decisions

1. Use the existing main SQLite database for the scheduler queue.
2. Do not create a second queue database.
3. Keep WAL mode and `busy_timeout` on the existing `DbProvider`.
4. Add a durable `scheduled_jobs` table through the normal migration system.
5. Run all cron scheduling in a new `cron-worker` entrypoint/container.
6. The main `app` executes jobs on HTTP request only; it no longer owns cron.
7. Remove `topic-of-day` completely, including code, UI, job API support, and
   chat config columns.
8. Route **all** scheduled jobs (including `state-evolution`) through the same
   `scheduled_jobs` queue — one mechanism, one dispatcher, uniform tests and
   observability.
9. Keep both `node-cron` and a reconciliation loop in the cron-worker, with the
   roles defined above.
10. Centralize cron expressions, timezone, and scheduler tuning in a new
    `CronWorkerConfig` (see Configuration).

## Why Use The Main Database

SQLite WAL mode already allows readers and writers to operate concurrently, and
the existing `DbProvider` enables WAL and a `busy_timeout`. A separate database
would add another migration path, another file to back up, another WAL/checkpoint
surface, and extra Docker configuration.

The scheduler queue performs short `INSERT` and `UPDATE` operations. If the main
database is too locked or unavailable for those writes, the main app would also
struggle to complete `fact-check` or `state-evolution`, because those jobs write
to the same database. A separate queue DB would not materially improve the
end-to-end success path.

## Runtime Roles

### app

The main app process:

- starts the Telegram bot;
- starts the HTTP server;
- exposes job execution endpoints;
- executes requested jobs;
- does not start fact-check, state-evolution, or topic-of-day cron schedules.

The app still owns business logic for:

- `state-evolution`;
- `fact-check`;
- `fact-check-stats`.

### cron-worker

The cron worker process:

- starts cron schedules (`node-cron`);
- runs a periodic reconciliation loop;
- computes due job slots;
- inserts due slots into `scheduled_jobs` with `INSERT OR IGNORE`;
- polls for pending/retry jobs;
- atomically claims one job at a time;
- sends HTTP requests to the app;
- records success, retry, or permanent failure.

The cron worker does not execute business logic directly. Its only execution
action is calling the app's internal HTTP job API.

## Build & Naming Invariant

The new worker must be built and shipped consistently. The build emits only the
entrypoints listed in `rsbuild.config.ts` `source.entry`, so a single name must
match across every layer:

- source file: `src/cron-worker.ts`;
- bundler entry: add `'cron-worker': './src/cron-worker.ts'` to
  `rsbuild.config.ts` `source.entry`;
- build output: `dist/cron-worker.js`;
- Docker command: `['node', 'dist/cron-worker.js']`;
- package scripts: `cron-worker` and `dev:cron-worker`.

All five use the identical token `cron-worker`.

The entrypoint follows the existing worker pattern in `src/voice-worker.ts`: it
builds its own Inversify `Container` via `registerRepositories` +
`registerApplication`, resolves the worker service, executes at top level, and
handles `SIGINT`/`SIGTERM`. It must **not** rely on a `require.main === module`
guard — rspack compiles that into an unreliable check that evaluates `false` in
the bundle (see the note at `src/migrate.ts:253`). `voice-worker.ts` already
executes unconditionally at top level; `cron-worker.ts` does the same.

> Anti-example to avoid: the current `audio-worker` scripts are out of sync —
> `package.json` and `docker-compose.yml` invoke `dist/audio-worker.js`, but the
> bundler only emits `voice-worker.js`. The invariant above exists to prevent
> repeating that mismatch.

## Scheduled Jobs

After removing `topic-of-day`, the scheduled job set is:

- `state-evolution`
- `fact-check`
- `fact-check-stats:daily`
- `fact-check-stats:weekly`
- `fact-check-stats:monthly`

All of them flow through the `scheduled_jobs` queue. Each scheduled run has a
deterministic `slot_key`. Examples:

- `state-evolution:2026-06-08T15:00Z`
- `fact-check:2026-06-08T14:00Z`
- `fact-check-stats:daily:2026-06-08`
- `fact-check-stats:weekly:2026-W24`
- `fact-check-stats:monthly:2026-06`

The exact formatting can be implementation-specific, but it must be stable and
unique for the scheduled period, and it must be computed in the **same timezone**
that the cron expression fires in (see Configuration). Otherwise the live
`node-cron` callback and the reconciliation loop could derive different
`slot_key` values for the same period and double-insert (especially for
daily/weekly/monthly, where the day boundary is timezone-sensitive).

### state-evolution through the queue

`state-evolution` is queued like every other job:

- `slot_key`: `state-evolution:<fire-time per sweepCron>`;
- `payload_json`: `{}`;
- mapping: `POST /jobs/state-evolution/all`.

This is intentionally uniform even though `state-evolution` already has a second,
independent self-healing layer: the HTTP handler runs
`StateEvolutionScheduler.sweep()`, which selects chats via
`findChatsNeedingSweep(now - maxIntervalMs)` from the cursor table. So the two
layers compose:

- the **queue** guarantees the sweep is *triggered* durably;
- the **cursor** guarantees per-chat *coverage* inside the sweep (a chat missed
  by one sweep is picked up by the next as long as some sweep fires within
  `maxIntervalMs`).

## Queue Table

Add a migration for:

```sql
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
```

Allowed statuses:

- `pending`
- `running`
- `retry_scheduled`
- `succeeded`
- `failed`

`payload_json` contains endpoint-specific data. For example:

```json
{}
```

for `fact-check`, and:

```json
{ "period": "weekly" }
```

for `fact-check-stats`.

## Queue Flow

### 1. Schedule Due Slots

For each configured schedule, the cron worker computes the current due slot and
inserts it:

```sql
INSERT OR IGNORE INTO scheduled_jobs (
  job_name,
  slot_key,
  payload_json,
  status,
  attempts,
  max_attempts,
  run_after,
  created_at,
  updated_at
) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?);
```

The unique `(job_name, slot_key)` constraint makes repeated scheduler ticks,
worker restarts, reconciliation passes, and catch-up checks idempotent. Both the
`node-cron` callbacks and the reconciliation loop use this same insert.

### 2. Claim Due Job

The dispatcher loop finds one due job where:

- `status = 'pending'`; or
- `status = 'retry_scheduled'` and `run_after <= now`; or
- `status = 'running'` and `locked_until <= now`.

It then atomically claims that row with a guarded update: select a candidate
`id`, then run an `UPDATE` that re-checks the claimable condition and only
commits if the row is still claimable:

```sql
UPDATE scheduled_jobs
SET status = 'running',
    attempts = attempts + 1,
    locked_until = ?,   -- now + lock_timeout
    updated_at = ?      -- now
WHERE id = ?
  AND (
    status = 'pending'
    OR (status = 'retry_scheduled' AND run_after <= ?)
    OR (status = 'running' AND locked_until <= ?)
  );
```

The claim succeeds only when the driver reports `changes === 1`. If `changes`
is `0`, another dispatcher iteration already claimed the row; skip it. This
guards against two overlapping async dispatcher iterations on the single
event loop claiming the same row.

### 3. Execute Via App HTTP

The cron worker maps each queue row to the app endpoint:

- `state-evolution` -> `POST /jobs/state-evolution/all`
- `fact-check` -> `POST /jobs/fact-check/all`
- `fact-check-stats` -> `POST /jobs/fact-check-stats/all` with `{ period }`

The app endpoint remains synchronous for this iteration. The cron worker should
therefore use a job execution timeout long enough for current jobs, and rely on
retry/lock expiry for recovery.

### 4. Finish Or Retry

On HTTP success, update the row:

- `status = 'succeeded'`;
- `finished_at = now`;
- clear `locked_until`;
- clear `last_error`.

On network failure, timeout, or non-2xx response:

- if `attempts < max_attempts`, set `status = 'retry_scheduled'`;
- set `run_after` using exponential backoff;
- clear `locked_until`;
- set `last_error`.

If attempts are exhausted:

- set `status = 'failed'`;
- set `finished_at = now`;
- clear `locked_until`;
- set `last_error`;
- emit a structured **error-level log** with `job_name`, `slot_key`, `attempts`,
  and `last_error`.

Permanent failure is observable through that error log plus the persisted
`status = 'failed'` / `last_error` on the row (queryable for diagnosis). A
proactive Telegram alert to `ADMIN_CHAT_ID` is intentionally out of scope for
this iteration (see Non-Goals) — the cron-worker holds no Telegram bot and would
need a new app endpoint to send one.

## Catch-Up Behavior

The cron worker should not rely only on exact cron callback timing. It runs a
periodic reconciliation loop (interval from `CronWorkerConfig`) that checks
recent slots and inserts missing rows. This loop is the durability guarantee
described in Background.

Initial implementation can check:

- current hourly slot;
- previous hourly slot;
- current daily/weekly/monthly stats slots;
- current `state-evolution` sweep slot.

This is enough to recover from short sleeps, restarts, and missed cron callbacks
without backfilling unbounded historical work.

## Removing topic-of-day

Delete runtime support for `topic-of-day`:

- remove `TopicOfDayScheduler` interface and implementation;
- remove `TOPIC_OF_DAY_SCHEDULER_ID` binding;
- remove `topic-of-day` from `JobName`, `JobRunInput`, `JobRunResult`,
  `AllChatsJobInput`, and `AllChatsJobResult`;
- remove `topic-of-day` branches from `DefaultJobRunner`;
- remove `topic-of-day` from `JobController` (`JOB_NAMES` and `dispatch`);
- remove `topic-of-day` from `scripts/trigger-job.mjs`;
- remove `job:topic-of-day` package scripts;
- remove topic-of-day prompt creation methods;
- remove `AIService.generateTopicOfDay`;
- remove `DefaultContentAiService.generateTopicOfDay`;
- remove prompt file mapping for `topicOfDaySystem`;
- remove Telegram menu items and conversations for setting topic time
  (including the `setTopicTime` action wired in `MainService` and the
  `topicTime` / `topicTimezone` fields returned by `MainService.getChatData`).

Add a migration:

```sql
ALTER TABLE chat_configs DROP COLUMN topic_time;
ALTER TABLE chat_configs DROP COLUMN topic_timezone;
```

The down migration restores:

```sql
ALTER TABLE chat_configs ADD COLUMN topic_time TEXT DEFAULT NULL;
ALTER TABLE chat_configs ADD COLUMN topic_timezone TEXT NOT NULL DEFAULT 'UTC';
```

After removal, `ChatConfigEntity` should contain only fields that are still used
by runtime behavior, currently:

- `chatId`
- `historyLimit`

## Configuration

Introduce a new `CronWorkerConfig` (with its own Inversify Symbol) that owns all
scheduling concerns for the cron-worker. It centralizes:

- **cron expressions**, relocated from existing configs:
  - from `FactCheckConfig`: `hourlyCron`, `dailyStatsCron`, `weeklyStatsCron`,
    `monthlyStatsCron`;
  - from `StateEvolutionConfig`: `sweepCron`;
- **timezone** (relocated from `FactCheckConfig.timezone`) — the single source of
  truth used for both cron firing and `slot_key` computation;
- **scheduler tuning**:
  - `JOBS_BASE_URL`, defaulting to `http://app:3000` in Docker and
    `http://localhost:3000` outside Docker;
  - `SCHEDULER_POLL_INTERVAL_MS`;
  - `RECONCILE_INTERVAL_MS`;
  - `SCHEDULER_LOCK_MS`;
  - `SCHEDULER_MAX_ATTEMPTS`;
  - retry backoff settings.

Business-logic fields stay where they are and are **not** moved:

- `FactCheckConfig`: `enabled` and all batch/threshold fields;
- `StateEvolutionConfig`: `enabled`, `maxIntervalMs`, `cooldownMs`,
  `eventThreshold`, etc. (`maxIntervalMs` still drives the cursor sweep logic in
  `app`).

Keep `FACT_CHECK_ENABLED` as the fact-check pipeline feature flag. Do not use it
to disable cron in the main app.

**Correctness requirement:** `slot_key` computation and cron firing must use the
same timezone (`CronWorkerConfig.timezone`).

## Docker

Add a new service:

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

Development override should run:

```yaml
command: pnpm dev:cron-worker
```

## Cutover / No Double-Fire

To move cron ownership cleanly out of `app`:

- `MainService.launch()` stops calling `stateEvolutionScheduler.start()` and
  `factCheckScheduler.start()`;
- the sweep methods still used by `JobRunner` (e.g.
  `StateEvolutionScheduler.sweep()`) remain; only the in-app cron `start()`
  wiring is removed;
- during a rolling deploy where old `app` (still owning cron) and the new
  `cron-worker` briefly overlap, both could fire the same schedule. The
  idempotent `slot_key` + `UNIQUE(job_name, slot_key)` constraint absorbs this:
  the second insert is ignored and the job runs once.

## Tests

Add focused tests for:

- scheduled job repository insert idempotency;
- atomic claim behavior (guarded update; `changes === 1`);
- no double-claim across overlapping dispatcher iterations;
- retry scheduling;
- stale running job reclaim;
- cron slot insertion;
- reconciliation inserts current + previous hourly slots and current
  daily/weekly/monthly + state-evolution slots;
- `CronWorkerConfig` parsing from env;
- dispatcher success path;
- dispatcher retry path;
- dispatcher failed-after-max-attempts path (and that it emits the error log);
- `state-evolution` routed through the queue to `/jobs/state-evolution/all`;
- `JobController` without `topic-of-day`;
- `DefaultJobRunner` without `topic-of-day`;
- `MainService` no longer starts the in-app cron schedulers;
- migration that creates `scheduled_jobs`;
- migration that drops `topic_time` and `topic_timezone`;
- Telegram routes without topic time conversations/buttons.

Update or delete existing topic-of-day tests.

## Non-Goals

This design does not make app job execution asynchronous. The app HTTP endpoint
can still wait for the job to finish. If job runtime becomes too long for HTTP,
that should be a follow-up design: app-side async execution returning `202
Accepted`.

This design does not send a proactive Telegram alert on permanent job failure.
Permanent failures are surfaced via error logs and the persisted `failed` row.
A Telegram alert (new app endpoint reusing the messenger + `ADMIN_CHAT_ID`) is a
possible follow-up.

This design does not backfill unlimited missed historical slots. It performs
bounded catch-up for recent slots only.

This design does not move business job execution into the cron worker.

## Open Implementation Notes

The implementation plan should decide the exact TypeScript names, but these
boundaries should remain:

- domain repository interface for scheduled jobs;
- SQLite repository implementation;
- cron slot scheduler service (node-cron + reconciliation);
- queue dispatcher service;
- `CronWorkerConfig` (with Symbol) and its env wiring;
- `cron-worker.ts` entrypoint;
- `rsbuild.config.ts` entry, Docker service, and package scripts for the new
  worker.
