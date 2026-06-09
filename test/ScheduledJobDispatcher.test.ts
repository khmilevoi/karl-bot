import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { CronWorkerConfig } from '../src/application/scheduler/CronWorkerConfig';
import { DefaultScheduledJobDispatcher } from '../src/application/scheduler/ScheduledJobDispatcher';
import type { ScheduledJobRepository } from '../src/domain/repositories/ScheduledJobRepository';
import type {
  ScheduledJob,
  ScheduledJobName,
} from '../src/domain/scheduler/ScheduledJobTypes';

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
const loggerFactory = {
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
    vi.unstubAllGlobals();
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

    const repo = makeRepo([job({ attempts: 3 }), null]);
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
