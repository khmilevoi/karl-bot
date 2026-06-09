# Cron Job HTTP Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the bot's cron-driven jobs (topic-of-day, state-evolution, fact-check, fact-check stats) as HTTP endpoints on the already-running server, with per-chat and all-chats variants, and replace the old `manual-job` CLI + pnpm scripts with scripts that hit those endpoints.

**Architecture:** Keep `node-cron` scheduling in-process unchanged. Generalize the existing `ManualJobRunner` into a `JobRunner` (`runForChat` + `runForAllChats`) that becomes the single execution path — both the fact-check cron callbacks and the new HTTP routes call it. A thin `node:http` layer lives in `src/view/http/`: `NodeHttpServer` owns the `find-my-way` router (radix tree) and socket loop, delegating validation/dispatch to a testable `JobController`. No auth (network isolation via Docker).

**Tech Stack:** TypeScript, Inversify (DI), `node:http` + `find-my-way` (router), node-cron, Vitest, rsbuild/rspack, pnpm. Node global `fetch` for the trigger script.

**Conventions:** Per repo `CLAUDE.md`, prefix shell commands with `rtk` (token optimizer). No `any` in `src/` (use `unknown`/discriminated unions); prefer pattern matching (`switch`) over ternaries; use `null` not `undefined`. Files under `docs/superpowers/` are git-ignored — never commit them.

**Reference spec:** `docs/superpowers/specs/2026-06-07-cron-job-http-endpoints-design.md`

---

## File Structure

**Create:**
- `src/application/interfaces/scheduler/JobRunner.ts` — job contract: `JobName`, `StatsPeriod`, `JobRunInput`, `JobRunResult`, `AllChatsJobInput`, `AllChatsJobResult`, `JobRunner` interface, `JOB_RUNNER_ID`.
- `src/application/use-cases/scheduler/DefaultJobRunner.ts` — implementation (per-chat + all-chats).
- `src/view/http/HttpServer.ts` — `HttpServer` lifecycle interface + `HTTP_SERVER_ID`.
- `src/view/http/JobController.ts` — validation + dispatch to `JobRunner`; `HttpResult` type + `JOB_CONTROLLER_ID`.
- `src/view/http/NodeHttpServer.ts` — `node:http` adapter implementing `HttpServer`; owns the `find-my-way` router (`lookup` + `defaultRoute`) and delegates to `JobController`.
- `scripts/trigger-job.mjs` — CLI that POSTs to the endpoints.
- `test/JobRunner.test.ts`, `test/FactCheckScheduler.test.ts`, `test/JobController.test.ts`, `test/NodeHttpServer.test.ts`, `test/triggerJobArgs.test.ts`.

**Modify:**
- `src/application/fact-checking/DefaultFactCheckScheduler.ts` — delegate all-chats loops to `JobRunner`.
- `src/container/application.ts` — rebind runner, register HTTP services.
- `src/index.ts` — start/stop `HttpServer` from the container instead of inline `http.createServer`.
- `rsbuild.config.ts` — drop the `manual-job` entry.
- `package.json` — remove old `job*` scripts, add new ones.
- `docker-compose.yml` — bind the published port to `127.0.0.1`.
- `.env.example`, `CLAUDE.md` — document `JOBS_BASE_URL` and the endpoints/scripts.

**Delete:**
- `src/manual-job.ts`, `src/application/interfaces/scheduler/ManualJobRunner.ts`, `src/application/use-cases/scheduler/DefaultManualJobRunner.ts`, `test/ManualJobRunner.test.ts`.

---

## Task 1: Remove the old manual-job CLI path

Self-contained removal. `manual-job.ts` is referenced only by the rsbuild entry and the `job*` pnpm scripts — no `src` code imports it — so deleting it keeps the build green. `DefaultManualJobRunner` stays bound but unused until Task 2 renames it.

**Files:**
- Delete: `src/manual-job.ts`
- Modify: `rsbuild.config.ts:8`
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Delete the CLI entrypoint**

```bash
rtk git rm src/manual-job.ts
```

- [ ] **Step 2: Remove the rsbuild entry**

In `rsbuild.config.ts`, delete the `'manual-job'` line so the entry block reads:

```ts
    entry: {
      index: './src/index.ts',
      migrate: './src/migrate.ts',
      'voice-worker': './src/audio-worker.ts',
    },
```

- [ ] **Step 3: Remove the old pnpm scripts**

In `package.json`, delete these three lines from `scripts`:

```jsonc
    "job": "pnpm build && node dist/manual-job.js",
    "job:state-evolution": "pnpm build && node dist/manual-job.js state-evolution",
    "job:topic-of-day": "pnpm build && node dist/manual-job.js topic-of-day",
```

- [ ] **Step 4: Verify the build still succeeds**

Run: `rtk pnpm build`
Expected: build completes; `dist/` no longer contains `manual-job.js`.

- [ ] **Step 5: Verify tests still pass**

Run: `rtk pnpm test`
Expected: PASS (the stale `test/ManualJobRunner.test.ts` still passes — it only exercises topic-of-day/state-evolution paths; it is removed in Task 2).

- [ ] **Step 6: Commit**

```bash
rtk git add -A
rtk git commit -m "chore: remove manual-job CLI entrypoint and scripts"
```

---

## Task 2: Rename `ManualJobRunner` → `JobRunner` and add all-chats support

Atomic rename + extension (interface, impl, container, test change together to compile). Adds `fact-check-stats` (with period) and `runForAllChats`. Test-first.

**Files:**
- Create: `src/application/interfaces/scheduler/JobRunner.ts`
- Delete: `src/application/interfaces/scheduler/ManualJobRunner.ts`
- Create: `src/application/use-cases/scheduler/DefaultJobRunner.ts`
- Delete: `src/application/use-cases/scheduler/DefaultManualJobRunner.ts`
- Modify: `src/container/application.ts:188-191`, `:219`, `:546-549`
- Create: `test/JobRunner.test.ts`
- Delete: `test/ManualJobRunner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/JobRunner.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { DefaultJobRunner } from '../src/application/use-cases/scheduler/DefaultJobRunner';
import type { StateEvolutionRunResult } from '../src/application/behavior/StateEvolutionPass';
import type { FactCheckRunResult } from '../src/application/fact-checking/FactCheckPipeline';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  }) as unknown as LoggerFactory;

function makeRunner(overrides?: {
  topicOfDay?: { runNow?: ReturnType<typeof vi.fn> };
  stateEvolution?: { run?: ReturnType<typeof vi.fn> };
  pipeline?: { runHourly?: ReturnType<typeof vi.fn>; runStats?: ReturnType<typeof vi.fn> };
  approval?: { listAll?: ReturnType<typeof vi.fn> };
  scheduler?: { sweep?: ReturnType<typeof vi.fn> };
}) {
  const topicOfDay = { runNow: vi.fn(async () => {}), ...overrides?.topicOfDay };
  const stateEvolution = { run: vi.fn(), ...overrides?.stateEvolution };
  const pipeline = {
    runHourly: vi.fn(),
    runStats: vi.fn(),
    ...overrides?.pipeline,
  };
  const approval = { listAll: vi.fn(async () => []), ...overrides?.approval };
  const scheduler = { sweep: vi.fn(async () => {}), ...overrides?.scheduler };
  const runner = new DefaultJobRunner(
    topicOfDay as never,
    stateEvolution as never,
    pipeline as never,
    approval as never,
    scheduler as never,
    createLoggerFactory()
  );
  return { runner, topicOfDay, stateEvolution, pipeline, approval, scheduler };
}

const factResult: FactCheckRunResult = {
  chatId: 0,
  outcome: 'completed',
  runId: 1,
  processedMessages: 3,
  persistedFindings: 2,
};

describe('DefaultJobRunner.runForChat', () => {
  it('runs topic-of-day for one chat', async () => {
    const { runner, topicOfDay } = makeRunner();
    const result = await runner.runForChat({ job: 'topic-of-day', chatId: 7 });
    expect(topicOfDay.runNow).toHaveBeenCalledWith(7);
    expect(result).toEqual({ job: 'topic-of-day', chatId: 7, outcome: 'completed' });
  });

  it('runs state-evolution and returns its result', async () => {
    const stateResult: StateEvolutionRunResult = {
      kind: 'evolved',
      behaviorEventId: 11,
      patchResults: [],
    };
    const { runner, stateEvolution } = makeRunner({
      stateEvolution: { run: vi.fn(async () => stateResult) },
    });
    const result = await runner.runForChat({ job: 'state-evolution', chatId: -5 });
    expect(stateEvolution.run).toHaveBeenCalledWith(-5);
    expect(result).toEqual({
      job: 'state-evolution',
      chatId: -5,
      outcome: 'evolved',
      stateEvolution: stateResult,
    });
  });

  it('runs fact-check hourly for one chat', async () => {
    const { runner, pipeline } = makeRunner({
      pipeline: { runHourly: vi.fn(async () => factResult) },
    });
    const result = await runner.runForChat({ job: 'fact-check', chatId: 9 });
    expect(pipeline.runHourly).toHaveBeenCalledWith(9);
    expect(result).toEqual({
      job: 'fact-check',
      chatId: 9,
      outcome: 'completed',
      factCheck: factResult,
    });
  });

  it('runs fact-check-stats for one chat with a period', async () => {
    const { runner, pipeline } = makeRunner({
      pipeline: { runStats: vi.fn(async () => factResult) },
    });
    const result = await runner.runForChat({
      job: 'fact-check-stats',
      chatId: 9,
      period: 'weekly',
    });
    expect(pipeline.runStats).toHaveBeenCalledWith(9, 'weekly');
    expect(result).toEqual({
      job: 'fact-check-stats',
      chatId: 9,
      period: 'weekly',
      outcome: 'completed',
      factCheck: factResult,
    });
  });
});

describe('DefaultJobRunner.runForAllChats', () => {
  it('runs fact-check only for approved chats and aggregates', async () => {
    const { runner, pipeline, approval } = makeRunner({
      pipeline: { runHourly: vi.fn(async () => factResult) },
      approval: {
        listAll: vi.fn(async () => [
          { chatId: 1, status: 'approved' },
          { chatId: 2, status: 'pending' },
          { chatId: 3, status: 'approved' },
        ]),
      },
    });
    const result = await runner.runForAllChats({ job: 'fact-check' });
    expect(approval.listAll).toHaveBeenCalledTimes(1);
    expect(pipeline.runHourly).toHaveBeenCalledTimes(2);
    expect(pipeline.runHourly).toHaveBeenCalledWith(1);
    expect(pipeline.runHourly).toHaveBeenCalledWith(3);
    expect(result).toEqual({
      job: 'fact-check',
      scope: 'all',
      totalChats: 2,
      results: [
        { job: 'fact-check', chatId: 1, outcome: 'completed', factCheck: factResult },
        { job: 'fact-check', chatId: 3, outcome: 'completed', factCheck: factResult },
      ],
    });
  });

  it('passes the period through for fact-check-stats all-chats', async () => {
    const { runner, pipeline } = makeRunner({
      pipeline: { runStats: vi.fn(async () => factResult) },
      approval: { listAll: vi.fn(async () => [{ chatId: 1, status: 'approved' }]) },
    });
    const result = await runner.runForAllChats({ job: 'fact-check-stats', period: 'daily' });
    expect(pipeline.runStats).toHaveBeenCalledWith(1, 'daily');
    expect(result).toEqual({
      job: 'fact-check-stats',
      scope: 'all',
      totalChats: 1,
      results: [
        {
          job: 'fact-check-stats',
          chatId: 1,
          period: 'daily',
          outcome: 'completed',
          factCheck: factResult,
        },
      ],
    });
  });

  it('continues past a failing chat and logs it', async () => {
    const runHourly = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(factResult);
    const { runner } = makeRunner({
      pipeline: { runHourly },
      approval: {
        listAll: vi.fn(async () => [
          { chatId: 1, status: 'approved' },
          { chatId: 2, status: 'approved' },
        ]),
      },
    });
    const result = await runner.runForAllChats({ job: 'fact-check' });
    expect(runHourly).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      job: 'fact-check',
      scope: 'all',
      totalChats: 2,
      results: [{ job: 'fact-check', chatId: 2, outcome: 'completed', factCheck: factResult }],
    });
  });

  it('delegates state-evolution all-chats to the scheduler sweep', async () => {
    const sweep = vi.fn(async () => {});
    const { runner, approval } = makeRunner({ scheduler: { sweep } });
    const result = await runner.runForAllChats({ job: 'state-evolution' });
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(approval.listAll).not.toHaveBeenCalled();
    expect(result).toEqual({ job: 'state-evolution', scope: 'all', outcome: 'swept' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk pnpm test test/JobRunner.test.ts`
Expected: FAIL — `Cannot find module '../src/application/use-cases/scheduler/DefaultJobRunner'`.

- [ ] **Step 3: Create the new contract**

Create `src/application/interfaces/scheduler/JobRunner.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

import type { StateEvolutionRunResult } from '@/application/behavior/StateEvolutionPass';
import type { FactCheckRunResult } from '@/application/fact-checking/FactCheckPipeline';

export type JobName =
  | 'state-evolution'
  | 'topic-of-day'
  | 'fact-check'
  | 'fact-check-stats';

export type StatsPeriod = 'daily' | 'weekly' | 'monthly';

export type JobRunInput =
  | { job: 'topic-of-day'; chatId: number }
  | { job: 'state-evolution'; chatId: number }
  | { job: 'fact-check'; chatId: number }
  | { job: 'fact-check-stats'; chatId: number; period: StatsPeriod };

export type JobRunResult =
  | { job: 'topic-of-day'; chatId: number; outcome: 'completed' }
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
  | { job: 'topic-of-day' }
  | { job: 'state-evolution' }
  | { job: 'fact-check' }
  | { job: 'fact-check-stats'; period: StatsPeriod };

export type AllChatsJobResult =
  | {
      job: 'topic-of-day' | 'fact-check' | 'fact-check-stats';
      scope: 'all';
      totalChats: number;
      results: JobRunResult[];
    }
  | { job: 'state-evolution'; scope: 'all'; outcome: 'swept' };

export interface JobRunner {
  runForChat(input: JobRunInput): Promise<JobRunResult>;
  runForAllChats(input: AllChatsJobInput): Promise<AllChatsJobResult>;
}

export const JOB_RUNNER_ID = Symbol.for(
  'JobRunner'
) as ServiceIdentifier<JobRunner>;
```

- [ ] **Step 4: Delete the old interface file**

```bash
rtk git rm src/application/interfaces/scheduler/ManualJobRunner.ts
```

- [ ] **Step 5: Create the new implementation**

Create `src/application/use-cases/scheduler/DefaultJobRunner.ts`:

```ts
import { inject, injectable } from 'inversify';

import {
  STATE_EVOLUTION_PASS_ID,
  type StateEvolutionPass,
} from '@/application/behavior/StateEvolutionPass';
import {
  STATE_EVOLUTION_SCHEDULER_ID,
  type StateEvolutionScheduler,
} from '@/application/behavior/StateEvolutionScheduler';
import {
  FACT_CHECK_PIPELINE_ID,
  type FactCheckPipeline,
} from '@/application/fact-checking/FactCheckPipeline';
import {
  CHAT_APPROVAL_SERVICE_ID,
  type ChatApprovalService,
} from '@/application/interfaces/chat/ChatApprovalService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  type AllChatsJobInput,
  type AllChatsJobResult,
  type JobRunInput,
  type JobRunner,
  type JobRunResult,
} from '@/application/interfaces/scheduler/JobRunner';
import {
  TOPIC_OF_DAY_SCHEDULER_ID,
  type TopicOfDayScheduler,
} from '@/application/interfaces/scheduler/TopicOfDayScheduler';

@injectable()
export class DefaultJobRunner implements JobRunner {
  private readonly logger: Logger;

  constructor(
    @inject(TOPIC_OF_DAY_SCHEDULER_ID)
    private readonly topicOfDay: TopicOfDayScheduler,
    @inject(STATE_EVOLUTION_PASS_ID)
    private readonly stateEvolution: StateEvolutionPass,
    @inject(FACT_CHECK_PIPELINE_ID)
    private readonly factCheckPipeline: FactCheckPipeline,
    @inject(CHAT_APPROVAL_SERVICE_ID)
    private readonly chatApproval: ChatApprovalService,
    @inject(STATE_EVOLUTION_SCHEDULER_ID)
    private readonly stateEvolutionScheduler: StateEvolutionScheduler,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('JobRunner');
  }

  async runForChat(input: JobRunInput): Promise<JobRunResult> {
    switch (input.job) {
      case 'topic-of-day':
        await this.topicOfDay.runNow(input.chatId);
        return { job: 'topic-of-day', chatId: input.chatId, outcome: 'completed' };
      case 'state-evolution': {
        const result = await this.stateEvolution.run(input.chatId);
        return {
          job: 'state-evolution',
          chatId: input.chatId,
          outcome: result.kind,
          stateEvolution: result,
        };
      }
      case 'fact-check': {
        const result = await this.factCheckPipeline.runHourly(input.chatId);
        return {
          job: 'fact-check',
          chatId: input.chatId,
          outcome: result.outcome,
          factCheck: result,
        };
      }
      case 'fact-check-stats': {
        const result = await this.factCheckPipeline.runStats(
          input.chatId,
          input.period
        );
        return {
          job: 'fact-check-stats',
          chatId: input.chatId,
          period: input.period,
          outcome: result.outcome,
          factCheck: result,
        };
      }
    }
  }

  async runForAllChats(input: AllChatsJobInput): Promise<AllChatsJobResult> {
    switch (input.job) {
      case 'state-evolution':
        await this.stateEvolutionScheduler.sweep();
        return { job: 'state-evolution', scope: 'all', outcome: 'swept' };
      case 'topic-of-day':
        return this.runEachApproved('topic-of-day', (chatId) => ({
          job: 'topic-of-day',
          chatId,
        }));
      case 'fact-check':
        return this.runEachApproved('fact-check', (chatId) => ({
          job: 'fact-check',
          chatId,
        }));
      case 'fact-check-stats': {
        const { period } = input;
        return this.runEachApproved('fact-check-stats', (chatId) => ({
          job: 'fact-check-stats',
          chatId,
          period,
        }));
      }
    }
  }

  private async runEachApproved(
    job: 'topic-of-day' | 'fact-check' | 'fact-check-stats',
    toInput: (chatId: number) => JobRunInput
  ): Promise<AllChatsJobResult> {
    const chats = await this.chatApproval.listAll();
    const approved = chats.filter((chat) => chat.status === 'approved');
    const results: JobRunResult[] = [];

    for (const { chatId } of approved) {
      try {
        results.push(await this.runForChat(toInput(chatId)));
      } catch (error) {
        this.logger.error(
          { error, chatId, job },
          'All-chats job run failed for chat'
        );
      }
    }

    return { job, scope: 'all', totalChats: approved.length, results };
  }
}
```

Each per-job factory returns a concrete single-variant literal, so it is assignable to the `JobRunInput` discriminated union (constructing `{ job: <union>, chatId }` directly would not type-check).

- [ ] **Step 6: Delete the old implementation file**

```bash
rtk git rm src/application/use-cases/scheduler/DefaultManualJobRunner.ts
```

- [ ] **Step 7: Update the container binding**

In `src/container/application.ts`, replace the old import (around lines 188-191):

```ts
import {
  MANUAL_JOB_RUNNER_ID,
  type ManualJobRunner,
} from '../application/interfaces/scheduler/ManualJobRunner';
```

with:

```ts
import {
  JOB_RUNNER_ID,
  type JobRunner,
} from '../application/interfaces/scheduler/JobRunner';
```

Replace the impl import (around line 219):

```ts
import { DefaultManualJobRunner } from '../application/use-cases/scheduler/DefaultManualJobRunner';
```

with:

```ts
import { DefaultJobRunner } from '../application/use-cases/scheduler/DefaultJobRunner';
```

Replace the binding (around lines 546-549):

```ts
  container
    .bind<ManualJobRunner>(MANUAL_JOB_RUNNER_ID)
    .to(DefaultManualJobRunner)
    .inSingletonScope();
```

with:

```ts
  container
    .bind<JobRunner>(JOB_RUNNER_ID)
    .to(DefaultJobRunner)
    .inSingletonScope();
```

- [ ] **Step 8: Delete the stale old test**

```bash
rtk git rm test/ManualJobRunner.test.ts
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `rtk pnpm test test/JobRunner.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 10: Type-check and build**

Run: `rtk pnpm type:check && rtk pnpm build`
Expected: no type errors; build succeeds.

- [ ] **Step 11: Commit**

```bash
rtk git add -A
rtk git commit -m "refactor: generalize ManualJobRunner into JobRunner with all-chats support"
```

---

## Task 3: Delegate fact-check all-chats loops to `JobRunner`

`DefaultFactCheckScheduler` keeps its cron registration but routes execution through `JobRunner.runForAllChats`, removing its duplicated approved-chat loops and its direct `ChatApprovalService`/`FactCheckPipeline` dependencies.

**Files:**
- Modify: `src/application/fact-checking/DefaultFactCheckScheduler.ts` (full rewrite)
- Create: `test/FactCheckScheduler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/FactCheckScheduler.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const scheduleMock = vi.fn();
vi.mock('node-cron', () => ({
  default: { schedule: (...args: unknown[]) => scheduleMock(...args) },
}));

import { DefaultFactCheckScheduler } from '../src/application/fact-checking/DefaultFactCheckScheduler';
import type { FactCheckConfig } from '../src/application/fact-checking/FactCheckConfig';
import type { JobRunner } from '../src/application/interfaces/scheduler/JobRunner';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  }) as unknown as LoggerFactory;

function makeConfig(enabled: boolean): FactCheckConfig {
  return {
    enabled,
    hourlyCron: 'HOURLY',
    dailyStatsCron: 'DAILY',
    weeklyStatsCron: 'WEEKLY',
    monthlyStatsCron: 'MONTHLY',
    timezone: 'UTC',
  } as unknown as FactCheckConfig;
}

function makeRunner(): JobRunner {
  return {
    runForChat: vi.fn(),
    runForAllChats: vi
      .fn()
      .mockResolvedValue({ job: 'fact-check', scope: 'all', totalChats: 0, results: [] }),
  };
}

beforeEach(() => {
  scheduleMock.mockReset();
});

describe('DefaultFactCheckScheduler', () => {
  it('does not register crons when disabled', async () => {
    const scheduler = new DefaultFactCheckScheduler(
      makeConfig(false),
      makeRunner(),
      createLoggerFactory()
    );
    await scheduler.start();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('registers four crons and delegates each to the JobRunner', async () => {
    const runner = makeRunner();
    const scheduler = new DefaultFactCheckScheduler(
      makeConfig(true),
      runner,
      createLoggerFactory()
    );
    await scheduler.start();

    expect(scheduleMock).toHaveBeenCalledTimes(4);
    const exprs = scheduleMock.mock.calls.map((call) => call[0]);
    expect(exprs).toEqual(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY']);

    // Invoke each captured cron callback (second arg of each schedule call).
    const callbacks = scheduleMock.mock.calls.map((call) => call[1] as () => void);
    callbacks[0]();
    callbacks[1]();
    callbacks[2]();
    callbacks[3]();

    expect(runner.runForAllChats).toHaveBeenCalledWith({ job: 'fact-check' });
    expect(runner.runForAllChats).toHaveBeenCalledWith({ job: 'fact-check-stats', period: 'daily' });
    expect(runner.runForAllChats).toHaveBeenCalledWith({ job: 'fact-check-stats', period: 'weekly' });
    expect(runner.runForAllChats).toHaveBeenCalledWith({ job: 'fact-check-stats', period: 'monthly' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk pnpm test test/FactCheckScheduler.test.ts`
Expected: FAIL — current scheduler constructor takes `(config, pipeline, chatApproval, loggerFactory)`, so `runForAllChats` is never called and the 2nd test fails (and the type/shape no longer matches).

- [ ] **Step 3: Rewrite the scheduler**

Replace the entire contents of `src/application/fact-checking/DefaultFactCheckScheduler.ts`:

```ts
import { inject, injectable } from 'inversify';
import cron from 'node-cron';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  JOB_RUNNER_ID,
  type JobRunner,
  type StatsPeriod,
} from '@/application/interfaces/scheduler/JobRunner';

import { FACT_CHECK_CONFIG_ID, type FactCheckConfig } from './FactCheckConfig';
import type { FactCheckScheduler } from './FactCheckScheduler';

@injectable()
export class DefaultFactCheckScheduler implements FactCheckScheduler {
  private readonly logger: Logger;

  constructor(
    @inject(FACT_CHECK_CONFIG_ID) private readonly config: FactCheckConfig,
    @inject(JOB_RUNNER_ID) private readonly jobRunner: JobRunner,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('DefaultFactCheckScheduler');
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Fact-check scheduler disabled');
      return;
    }

    cron.schedule(this.config.hourlyCron, () => void this.runHourly(), {
      timezone: this.config.timezone,
    });
    this.scheduleStats('daily', this.config.dailyStatsCron);
    this.scheduleStats('weekly', this.config.weeklyStatsCron);
    this.scheduleStats('monthly', this.config.monthlyStatsCron);

    this.logger.info(
      { hourlyCron: this.config.hourlyCron, timezone: this.config.timezone },
      'Fact-check scheduler started'
    );
  }

  private scheduleStats(period: StatsPeriod, expr: string): void {
    cron.schedule(expr, () => void this.runStats(period), {
      timezone: this.config.timezone,
    });
  }

  private async runHourly(): Promise<void> {
    const result = await this.jobRunner
      .runForAllChats({ job: 'fact-check' })
      .catch((err: unknown) => {
        this.logger.error({ err }, 'Hourly fact-check run failed');
        return null;
      });
    if (result && 'totalChats' in result) {
      this.logger.debug(
        { totalChats: result.totalChats },
        'Hourly fact-check run complete'
      );
    }
  }

  private async runStats(period: StatsPeriod): Promise<void> {
    const result = await this.jobRunner
      .runForAllChats({ job: 'fact-check-stats', period })
      .catch((err: unknown) => {
        this.logger.error({ err, period }, 'Stats fact-check run failed');
        return null;
      });
    if (result && 'totalChats' in result) {
      this.logger.debug(
        { period, totalChats: result.totalChats },
        'Stats fact-check run complete'
      );
    }
  }
}
```

Note: the container binds `DefaultFactCheckScheduler` via `.to(...)`, which reads the constructor decorators, so no `container/application.ts` change is needed for the new dependencies.

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk pnpm test test/FactCheckScheduler.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check**

Run: `rtk pnpm type:check`
Expected: no errors (the old `ChatApprovalService`/`FactCheckPipeline` imports in this file are gone).

- [ ] **Step 6: Commit**

```bash
rtk git add -A
rtk git commit -m "refactor: route fact-check cron through JobRunner.runForAllChats"
```

---

## Task 4: `JobController` — validation + dispatch

Pure unit: `run(jobName, scope, body)` validates `chatId`/`period`, dispatches to `JobRunner`, and returns an `HttpResult`. No sockets, no path matching — fully unit-testable. Routing (find-my-way) lives in `NodeHttpServer` (Task 5).

**Files:**
- Create: `src/view/http/HttpServer.ts`
- Create: `src/view/http/JobController.ts`
- Create: `test/JobController.test.ts`

- [ ] **Step 1: Create the lifecycle interface**

Create `src/view/http/HttpServer.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

export interface HttpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const HTTP_SERVER_ID = Symbol.for(
  'HttpServer'
) as ServiceIdentifier<HttpServer>;
```

- [ ] **Step 2: Write the failing test**

Create `test/JobController.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { JobController } from '../src/view/http/JobController';
import type { JobRunner } from '../src/application/interfaces/scheduler/JobRunner';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const loggerFactory = {
  create: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
} as unknown as LoggerFactory;

function makeController(runner: Partial<JobRunner>) {
  return new JobController(runner as JobRunner, loggerFactory);
}

describe('JobController', () => {
  it('returns 404 for an unknown job name', async () => {
    const controller = makeController({ runForChat: vi.fn() });
    const res = await controller.run('nope', 'chat', {});
    expect(res.status).toBe(404);
  });

  it('returns 400 when chatId is missing for a per-chat job', async () => {
    const controller = makeController({ runForChat: vi.fn() });
    const res = await controller.run('fact-check', 'chat', {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when chatId is not an integer', async () => {
    const controller = makeController({ runForChat: vi.fn() });
    const res = await controller.run('fact-check', 'chat', { chatId: 1.5 });
    expect(res.status).toBe(400);
  });

  it('runs a per-chat job and wraps the result with ok:true', async () => {
    const runForChat = vi.fn(async () => ({
      job: 'fact-check',
      chatId: 5,
      outcome: 'completed',
      factCheck: { chatId: 5, outcome: 'completed', runId: 1, processedMessages: 0, persistedFindings: 0 },
    }));
    const controller = makeController({ runForChat: runForChat as never });
    const res = await controller.run('fact-check', 'chat', { chatId: 5 });
    expect(runForChat).toHaveBeenCalledWith({ job: 'fact-check', chatId: 5 });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, job: 'fact-check', chatId: 5 });
  });

  it('requires a valid period for fact-check-stats (per-chat)', async () => {
    const controller = makeController({ runForChat: vi.fn() });
    const res = await controller.run('fact-check-stats', 'chat', { chatId: 5 });
    expect(res.status).toBe(400);
  });

  it('runs fact-check-stats per-chat with a period', async () => {
    const runForChat = vi.fn(async () => ({
      job: 'fact-check-stats',
      chatId: 5,
      period: 'weekly',
      outcome: 'completed',
      factCheck: { chatId: 5, outcome: 'completed', runId: 1, processedMessages: 0, persistedFindings: 0 },
    }));
    const controller = makeController({ runForChat: runForChat as never });
    const res = await controller.run('fact-check-stats', 'chat', { chatId: 5, period: 'weekly' });
    expect(runForChat).toHaveBeenCalledWith({ job: 'fact-check-stats', chatId: 5, period: 'weekly' });
    expect(res.status).toBe(200);
  });

  it('runs an all-chats job', async () => {
    const runForAllChats = vi.fn(async () => ({
      job: 'fact-check',
      scope: 'all',
      totalChats: 0,
      results: [],
    }));
    const controller = makeController({ runForAllChats: runForAllChats as never });
    const res = await controller.run('fact-check', 'all', {});
    expect(runForAllChats).toHaveBeenCalledWith({ job: 'fact-check' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, scope: 'all' });
  });

  it('requires a period for fact-check-stats all-chats', async () => {
    const controller = makeController({ runForAllChats: vi.fn() });
    const res = await controller.run('fact-check-stats', 'all', {});
    expect(res.status).toBe(400);
  });

  it('returns 500 when the runner throws', async () => {
    const controller = makeController({
      runForChat: vi.fn(async () => {
        throw new Error('kaboom');
      }),
    });
    const res = await controller.run('fact-check', 'chat', { chatId: 5 });
    expect(res.status).toBe(500);
    expect(res.json).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `rtk pnpm test test/JobController.test.ts`
Expected: FAIL — `Cannot find module '../src/view/http/JobController'`.

- [ ] **Step 4: Implement `JobController`**

Create `src/view/http/JobController.ts`:

```ts
import { inject, injectable, type ServiceIdentifier } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  JOB_RUNNER_ID,
  type AllChatsJobResult,
  type JobName,
  type JobRunner,
  type JobRunResult,
  type StatsPeriod,
} from '@/application/interfaces/scheduler/JobRunner';

export interface HttpResult {
  status: number;
  json?: Record<string, unknown> | unknown[];
  text?: string;
}

const JOB_NAMES: readonly JobName[] = [
  'topic-of-day',
  'state-evolution',
  'fact-check',
  'fact-check-stats',
];

const STATS_PERIODS: readonly StatsPeriod[] = ['daily', 'weekly', 'monthly'];

@injectable()
export class JobController {
  private readonly logger: Logger;

  constructor(
    @inject(JOB_RUNNER_ID) private readonly runner: JobRunner,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('JobController');
  }

  async run(
    jobName: string,
    scope: 'chat' | 'all',
    body: Record<string, unknown>
  ): Promise<HttpResult> {
    if (!JOB_NAMES.includes(jobName as JobName)) {
      return { status: 404, json: { ok: false, error: 'not found' } };
    }
    try {
      return await this.dispatch(jobName as JobName, scope, body);
    } catch (error) {
      this.logger.error({ error, jobName, scope }, 'Job execution failed');
      return {
        status: 500,
        json: {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async dispatch(
    job: JobName,
    scope: 'chat' | 'all',
    body: Record<string, unknown>
  ): Promise<HttpResult> {
    switch (job) {
      case 'topic-of-day':
        return scope === 'chat'
          ? this.perChat(body, (chatId) =>
              this.runner.runForChat({ job: 'topic-of-day', chatId })
            )
          : this.wrap(this.runner.runForAllChats({ job: 'topic-of-day' }));
      case 'state-evolution':
        return scope === 'chat'
          ? this.perChat(body, (chatId) =>
              this.runner.runForChat({ job: 'state-evolution', chatId })
            )
          : this.wrap(this.runner.runForAllChats({ job: 'state-evolution' }));
      case 'fact-check':
        return scope === 'chat'
          ? this.perChat(body, (chatId) =>
              this.runner.runForChat({ job: 'fact-check', chatId })
            )
          : this.wrap(this.runner.runForAllChats({ job: 'fact-check' }));
      case 'fact-check-stats': {
        const period = this.parsePeriod(body);
        if (period === null) return this.badPeriod();
        return scope === 'chat'
          ? this.perChat(body, (chatId) =>
              this.runner.runForChat({ job: 'fact-check-stats', chatId, period })
            )
          : this.wrap(this.runner.runForAllChats({ job: 'fact-check-stats', period }));
      }
    }
  }

  private async perChat(
    body: Record<string, unknown>,
    run: (chatId: number) => Promise<JobRunResult>
  ): Promise<HttpResult> {
    const chatId = this.parseChatId(body);
    if (chatId === null) {
      return {
        status: 400,
        json: { ok: false, error: 'chatId (integer) is required' },
      };
    }
    return this.wrap(run(chatId));
  }

  private async wrap(
    promise: Promise<JobRunResult | AllChatsJobResult>
  ): Promise<HttpResult> {
    const result = await promise;
    return { status: 200, json: { ok: true, ...result } };
  }

  private badPeriod(): HttpResult {
    return {
      status: 400,
      json: { ok: false, error: 'period must be one of daily|weekly|monthly' },
    };
  }

  private parseChatId(body: Record<string, unknown>): number | null {
    const value = body.chatId;
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
  }

  private parsePeriod(body: Record<string, unknown>): StatsPeriod | null {
    const value = body.period;
    return typeof value === 'string' && STATS_PERIODS.includes(value as StatsPeriod)
      ? (value as StatsPeriod)
      : null;
  }
}

export const JOB_CONTROLLER_ID = Symbol.for(
  'JobController'
) as ServiceIdentifier<JobController>;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `rtk pnpm test test/JobController.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Type-check**

Run: `rtk pnpm type:check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
rtk git add -A
rtk git commit -m "feat: add JobController for HTTP job validation and dispatch"
```

---

## Task 5: `NodeHttpServer` (find-my-way routing) + container wiring + index.ts

`NodeHttpServer` owns the `find-my-way` router and the socket loop: `lookup(req, res)` dispatches matched routes to handlers that read the body, call `JobController.run`, and write the response; `defaultRoute` produces 404/405. Routing is covered by an integration test (ephemeral port + `fetch`). `find-my-way` is pure JS and bundles via rspack — no `rsbuild.config.ts` externals change needed.

**Files:**
- Modify: `package.json` (add `find-my-way` dependency)
- Create: `src/view/http/NodeHttpServer.ts`
- Create: `test/NodeHttpServer.test.ts`
- Modify: `src/container/application.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add the `find-my-way` dependency**

Run (updates `package.json` + `pnpm-lock.yaml`):

```bash
rtk pnpm add find-my-way
```

- [ ] **Step 2: Write the failing test**

Create `test/NodeHttpServer.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeHttpServer } from '../src/view/http/NodeHttpServer';
import type { HttpResult, JobController } from '../src/view/http/JobController';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const loggerFactory = {
  create: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
} as unknown as LoggerFactory;

function makeController(run: (...args: unknown[]) => Promise<HttpResult>): JobController {
  return { run } as unknown as JobController;
}

describe('NodeHttpServer', () => {
  const originalPort = process.env.PORT;
  let server: NodeHttpServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    process.env.PORT = originalPort;
  });

  it('routes a per-chat POST to the controller with the parsed body', async () => {
    process.env.PORT = '0';
    const run = vi.fn(async (): Promise<HttpResult> => ({ status: 200, json: { ok: true, echoed: true } }));
    server = new NodeHttpServer(makeController(run), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/jobs/fact-check`, {
      method: 'POST',
      body: JSON.stringify({ chatId: 1 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, echoed: true });
    expect(run).toHaveBeenCalledWith('fact-check', 'chat', { chatId: 1 });
  });

  it('routes an all-chats POST with an empty body to the controller', async () => {
    process.env.PORT = '0';
    const run = vi.fn(async (): Promise<HttpResult> => ({ status: 200, json: { ok: true } }));
    server = new NodeHttpServer(makeController(run), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/jobs/fact-check/all`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith('fact-check', 'all', {});
  });

  it('serves GET /health as text without touching the controller', async () => {
    process.env.PORT = '0';
    const run = vi.fn();
    server = new NodeHttpServer(makeController(run as never), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('ok');
    expect(run).not.toHaveBeenCalled();
  });

  it('returns 405 for a known path with the wrong method', async () => {
    process.env.PORT = '0';
    server = new NodeHttpServer(makeController(vi.fn() as never), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/jobs/fact-check`, { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('returns 404 for an unknown path', async () => {
    process.env.PORT = '0';
    server = new NodeHttpServer(makeController(vi.fn() as never), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/nope`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid JSON body without calling the controller', async () => {
    process.env.PORT = '0';
    const run = vi.fn();
    server = new NodeHttpServer(makeController(run as never), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/jobs/fact-check`, {
      method: 'POST',
      body: '{not json',
    });

    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `rtk pnpm test test/NodeHttpServer.test.ts`
Expected: FAIL — `Cannot find module '../src/view/http/NodeHttpServer'`.

- [ ] **Step 4: Implement `NodeHttpServer`**

Create `src/view/http/NodeHttpServer.ts`:

```ts
import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import Router from 'find-my-way';
import { inject, injectable } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';

import type { HttpServer } from './HttpServer';
import {
  JOB_CONTROLLER_ID,
  type HttpResult,
  type JobController,
} from './JobController';

// Only the methods we register — used to tell 404 (no such path) from 405
// (path exists under a different method). find-my-way has no built-in 405.
const PROBE_METHODS = ['GET', 'POST'] as const;

@injectable()
export class NodeHttpServer implements HttpServer {
  private readonly logger: Logger;
  private readonly configuredPort: number;
  private readonly router: Router.Instance<Router.HTTPVersion.V1>;
  private server: Server | null = null;

  constructor(
    @inject(JOB_CONTROLLER_ID) private readonly controller: JobController,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('NodeHttpServer');
    this.configuredPort = Number(process.env.PORT ?? 3000);
    this.router = Router({
      ignoreTrailingSlash: true,
      defaultRoute: (req, res) => this.handleUnmatched(req, res),
    });
    this.router.on('GET', '/health', (_req, res) => {
      this.send(res, { status: 200, text: 'ok' });
    });
    this.router.on('POST', '/jobs/:job', (req, res, params) => {
      void this.runJob(req, res, params.job, 'chat');
    });
    this.router.on('POST', '/jobs/:job/all', (req, res, params) => {
      void this.runJob(req, res, params.job, 'all');
    });
  }

  get port(): number | null {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  async start(): Promise<void> {
    const server = http.createServer((req, res) => {
      this.router.lookup(req, res);
    });
    this.server = server;
    await new Promise<void>((resolve) => {
      server.listen(this.configuredPort, () => resolve());
    });
    this.logger.info({ port: this.port }, 'HTTP server listening');
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = null;
  }

  private async runJob(
    req: IncomingMessage,
    res: ServerResponse,
    jobName: string | undefined,
    scope: 'chat' | 'all'
  ): Promise<void> {
    try {
      const rawBody = await this.readBody(req);
      const body = this.parseBody(rawBody);
      if (body === null) {
        this.send(res, {
          status: 400,
          json: { ok: false, error: 'invalid JSON body' },
        });
        return;
      }
      this.send(res, await this.controller.run(jobName ?? '', scope, body));
    } catch (error) {
      this.logger.error({ error, jobName, scope }, 'Job request failed');
      this.send(res, {
        status: 500,
        json: {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // find-my-way calls defaultRoute for any unmatched (method, path). Report 405
  // if the path exists under another method, otherwise 404.
  private handleUnmatched(req: IncomingMessage, res: ServerResponse): void {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const existsForOtherMethod = PROBE_METHODS.some(
      (probe) => probe !== method && this.router.find(probe, pathname) !== null
    );
    this.send(
      res,
      existsForOtherMethod
        ? { status: 405, json: { ok: false, error: 'method not allowed' } }
        : { status: 404, json: { ok: false, error: 'not found' } }
    );
  }

  private send(res: ServerResponse, result: HttpResult): void {
    if (result.text !== undefined) {
      res.writeHead(result.status, { 'content-type': 'text/plain' });
      res.end(result.text);
      return;
    }
    res.writeHead(result.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.json ?? {}));
  }

  private parseBody(rawBody: string): Record<string, unknown> | null {
    if (rawBody.trim().length === 0) return {};
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
}
```

Notes:
- The `:job` param is validated inside `JobController.run` (unknown job → 404), so the router only needs the generic `/jobs/:job` pattern.
- Handlers are fire-and-forget (`void this.runJob(...)`) — `lookup()` doesn't await them; each handler owns writing its own response.

- [ ] **Step 5: Run the test to verify it passes**

Run: `rtk pnpm test test/NodeHttpServer.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Register the HTTP services in the container**

In `src/container/application.ts`, add these imports near the other `view`/`interfaces` imports (e.g. just after the `JobRunner` import added in Task 2):

```ts
import {
  HTTP_SERVER_ID,
  type HttpServer,
} from '../view/http/HttpServer';
import {
  JOB_CONTROLLER_ID,
  JobController,
} from '../view/http/JobController';
import { NodeHttpServer } from '../view/http/NodeHttpServer';
```

Then, inside `register`, add these bindings right after the `JOB_RUNNER_ID` binding:

```ts
  container
    .bind<JobController>(JOB_CONTROLLER_ID)
    .to(JobController)
    .inSingletonScope();

  container
    .bind<HttpServer>(HTTP_SERVER_ID)
    .to(NodeHttpServer)
    .inSingletonScope();
```

- [ ] **Step 7: Rewrite `src/index.ts`**

Replace the entire contents of `src/index.ts`:

```ts
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from './application/interfaces/logging/LoggerFactory';
import { container } from './container';
import { HTTP_SERVER_ID, type HttpServer } from './view/http/HttpServer';
import { MainService } from './view/telegram/MainService';

const loggerFactory = container.get<LoggerFactory>(LOGGER_FACTORY_ID);
const logger = loggerFactory.create('index');
const main = container.get<MainService>(MainService);
const httpServer = container.get<HttpServer>(HTTP_SERVER_ID);

logger.info('Starting application');
void main.launch();
void httpServer.start();

function shutdown(reason: string): void {
  logger.info(`${reason} received`);
  void httpServer.stop();
  main.stop(reason);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
```

- [ ] **Step 8: Type-check, build, and run the full test suite**

Run: `rtk pnpm type:check && rtk pnpm build && rtk pnpm test`
Expected: no type errors; build succeeds; all tests PASS.

- [ ] **Step 9: Smoke-test the running server**

Run (starts the built server; requires a valid `.env`):
```bash
rtk pnpm start
```
In another shell:
```bash
rtk curl -s http://localhost:3000/health
```
Expected: `ok`. Stop the server (Ctrl+C) and confirm a clean shutdown log line.

- [ ] **Step 10: Commit**

```bash
rtk git add -A
rtk git commit -m "feat: serve cron jobs over HTTP via find-my-way + NodeHttpServer"
```

---

## Task 6: `trigger-job.mjs` + new pnpm scripts

Cross-platform CLI (Node global `fetch`) that POSTs to the endpoints. `parseArgs` is exported and unit-tested; `main()` runs only when invoked directly.

**Files:**
- Create: `scripts/trigger-job.mjs`
- Create: `test/triggerJobArgs.test.ts`
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Write the failing test**

Create `test/triggerJobArgs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

// scripts/ is plain ESM JS (not type-checked by tsc, which excludes test/).
import { parseArgs } from '../scripts/trigger-job.mjs';

describe('trigger-job parseArgs', () => {
  it('rejects an unknown job', () => {
    expect(parseArgs(['nope', '--all']).ok).toBe(false);
  });

  it('requires exactly one of --chat-id or --all', () => {
    expect(parseArgs(['fact-check']).ok).toBe(false);
    expect(parseArgs(['fact-check', '--all', '--chat-id', '1']).ok).toBe(false);
  });

  it('parses a per-chat job', () => {
    expect(parseArgs(['fact-check', '--chat-id', '42'])).toEqual({
      ok: true,
      job: 'fact-check',
      all: false,
      chatId: '42',
      period: null,
    });
  });

  it('parses an all-chats job', () => {
    expect(parseArgs(['topic-of-day', '--all'])).toEqual({
      ok: true,
      job: 'topic-of-day',
      all: true,
      chatId: null,
      period: null,
    });
  });

  it('requires a valid period for fact-check-stats', () => {
    expect(parseArgs(['fact-check-stats', '--all']).ok).toBe(false);
    expect(parseArgs(['fact-check-stats', '--all', '--period', 'yearly']).ok).toBe(false);
    expect(parseArgs(['fact-check-stats', '--all', '--period', 'weekly'])).toEqual({
      ok: true,
      job: 'fact-check-stats',
      all: true,
      chatId: null,
      period: 'weekly',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk pnpm test test/triggerJobArgs.test.ts`
Expected: FAIL — `Cannot find module '../scripts/trigger-job.mjs'`.

- [ ] **Step 3: Implement the trigger script**

Create `scripts/trigger-job.mjs`:

```js
// Triggers a bot job via the running HTTP server.
//
// Usage:
//   node scripts/trigger-job.mjs <job> --chat-id <n>
//   node scripts/trigger-job.mjs <job> --all
//   node scripts/trigger-job.mjs fact-check-stats --period weekly --all
//
// Base URL: $JOBS_BASE_URL, else http://localhost:$PORT (PORT defaults to 3000).
import { pathToFileURL } from 'node:url';

const JOBS = ['topic-of-day', 'state-evolution', 'fact-check', 'fact-check-stats'];
const PERIODS = ['daily', 'weekly', 'monthly'];

export function parseArgs(argv) {
  const [job, ...rest] = argv;
  if (!job || !JOBS.includes(job)) {
    return { ok: false, error: `Unknown job "${job ?? ''}". Expected one of: ${JOBS.join(', ')}` };
  }

  let chatId = null;
  let all = false;
  let period = null;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--chat-id') {
      chatId = rest[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--chat-id=')) {
      chatId = arg.slice('--chat-id='.length);
    } else if (arg === '--period') {
      period = rest[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--period=')) {
      period = arg.slice('--period='.length);
    } else {
      return { ok: false, error: `Unknown argument: ${arg}` };
    }
  }

  if (all === (chatId !== null)) {
    return { ok: false, error: 'Specify exactly one of --chat-id <n> or --all' };
  }
  if (job === 'fact-check-stats' && (period === null || !PERIODS.includes(period))) {
    return { ok: false, error: `fact-check-stats requires --period <${PERIODS.join('|')}>` };
  }

  return { ok: true, job, all, chatId, period };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`);
    process.exitCode = 1;
    return;
  }

  const base = process.env.JOBS_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  const path = parsed.all ? `/jobs/${parsed.job}/all` : `/jobs/${parsed.job}`;
  const body = {};
  if (!parsed.all) body.chatId = Number(parsed.chatId);
  if (parsed.period) body.period = parsed.period;

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  process.stdout.write(`${await res.text()}\n`);
  process.exitCode = res.ok ? 0 : 1;
}

const isMain =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk pnpm test test/triggerJobArgs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the new pnpm scripts**

In `package.json`, add these to `scripts` (place where the old `job*` scripts were):

```jsonc
    "job": "node scripts/trigger-job.mjs",
    "job:topic-of-day": "node scripts/trigger-job.mjs topic-of-day",
    "job:topic-of-day:all": "node scripts/trigger-job.mjs topic-of-day --all",
    "job:state-evolution": "node scripts/trigger-job.mjs state-evolution",
    "job:state-evolution:all": "node scripts/trigger-job.mjs state-evolution --all",
    "job:fact-check": "node scripts/trigger-job.mjs fact-check",
    "job:fact-check:all": "node scripts/trigger-job.mjs fact-check --all",
    "job:fact-check-stats": "node scripts/trigger-job.mjs fact-check-stats",
    "job:fact-check-stats:all": "node scripts/trigger-job.mjs fact-check-stats --all",
```

- [ ] **Step 6: Smoke-test the CLI against a running server**

With the server running (`rtk pnpm start` in another shell) and at least one approved chat:
```bash
rtk pnpm job:fact-check --chat-id <realChatId>
rtk pnpm job:fact-check-stats --period weekly --all
```
Expected: each prints a JSON response and exits 0. Bad args exit non-zero:
```bash
node scripts/trigger-job.mjs fact-check-stats --all
```
Expected: stderr "fact-check-stats requires --period ...", exit code 1.

- [ ] **Step 7: Commit**

```bash
rtk git add -A
rtk git commit -m "feat: add trigger-job script and pnpm job commands"
```

---

## Task 7: Bind port to localhost + point healthcheck at /health (Docker)

Two changes to `docker-compose.yml`:
1. Implements the "localhost / internal network only" decision — the host-published port becomes reachable only from the host loopback, not the network.
2. **Required fix:** the healthcheck currently hits root `/`, which the old catch-all server answered with `200`. The new server only serves `/health` and the job routes, so root `/` now returns `404` and the healthcheck must target `/health`.

**Files:**
- Modify: `docker-compose.yml` (`app` service `ports` ~line 40-41 and `healthcheck` ~line 46-55)

- [ ] **Step 1: Restrict the published port**

In `docker-compose.yml`, change the `app` service `ports` mapping from:

```yaml
    ports:
      - '${PORT:-3000}:3000'
```

to:

```yaml
    ports:
      - '127.0.0.1:${PORT:-3000}:3000'
```

- [ ] **Step 2: Point the healthcheck at `/health`**

In the `app` service `healthcheck.test`, change the probe URL from `http://127.0.0.1:3000` to `http://127.0.0.1:3000/health`. The line becomes:

```yaml
        - "require('http').get('http://127.0.0.1:3000/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
```

- [ ] **Step 3: Validate the compose file**

Run: `rtk docker compose -f docker-compose.yml config`
Expected: prints the resolved config with `127.0.0.1:3000:3000` and the `/health` probe URL, no errors.

- [ ] **Step 4: Commit**

```bash
rtk git add -A
rtk git commit -m "chore: bind app HTTP port to localhost and probe /health"
```

---

## Task 8: Documentation

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document `JOBS_BASE_URL`**

In `.env.example`, add after the `PORT=3000` line:

```dotenv
# Base URL the job-trigger scripts (pnpm job:*) POST to. Defaults to
# http://localhost:$PORT. Set when triggering jobs against a remote/container host.
JOBS_BASE_URL=http://localhost:3000
```

- [ ] **Step 2: Document the endpoints and scripts**

In `CLAUDE.md`, under "## Development Commands", add a new subsection:

```markdown
**Jobs (HTTP-triggered):**

The running server exposes cron jobs over HTTP (no auth — localhost/internal only).
These pnpm scripts POST to the running bot (it must be up):

- `pnpm job:topic-of-day --chat-id <id>` / `pnpm job:topic-of-day:all`
- `pnpm job:state-evolution --chat-id <id>` (force) / `pnpm job:state-evolution:all` (sweep)
- `pnpm job:fact-check --chat-id <id>` / `pnpm job:fact-check:all`
- `pnpm job:fact-check-stats --period <daily|weekly|monthly> --chat-id <id>` / `... :all`

Endpoints: `POST /jobs/<job>` (per-chat, JSON `{ chatId, period? }`) and
`POST /jobs/<job>/all` (all approved chats). Health: `GET /health`.
Base URL via `JOBS_BASE_URL` (default `http://localhost:$PORT`).
```

- [ ] **Step 3: Commit**

```bash
rtk git add -A
rtk git commit -m "docs: document job HTTP endpoints and trigger scripts"
```

---

## Final Verification

- [ ] **Full suite green**

Run: `rtk pnpm type:check && rtk pnpm lint && rtk pnpm build && rtk pnpm test`
Expected: type-check clean, lint clean, build succeeds, all tests PASS.

- [ ] **Confirm old path is gone**

Run: `rtk grep "manual-job|ManualJob|MANUAL_JOB" src package.json rsbuild.config.ts`
Expected: no matches.

- [ ] **Confirm endpoints exist end-to-end**

Start the server, then:
```bash
rtk curl -s http://localhost:3000/health
rtk curl -s -X POST http://localhost:3000/jobs/fact-check/all
```
Expected: `ok`, then a JSON aggregate (`{"ok":true,"job":"fact-check","scope":"all",...}`).

---

## Notes / Deviations from spec

- **state-evolution all-chats result** is `{ scope: 'all', outcome: 'swept' }` rather than a count of requested runs. `StateEvolutionScheduler.sweep()` returns `void`, so a count isn't available without widening that interface (out of scope). The sweep itself logs the count it requested.
- **all-chats resilience:** a per-chat failure during an all-chats run is logged and skipped; the chat is omitted from `results` but still counted in `totalChats`. This mirrors the previous scheduler behavior.
- **`fact-check-stats` is a distinct job** (with a `period`) rather than overloading `fact-check`, matching the cron surface (hourly vs daily/weekly/monthly stats).
```
