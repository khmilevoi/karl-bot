import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { CronWorkerConfig } from '../src/application/scheduler/CronWorkerConfig';
import { DefaultCronSlotScheduler } from '../src/application/scheduler/CronSlotScheduler';
import type { ScheduledJobRepository } from '../src/domain/repositories/ScheduledJobRepository';
import type { DueSlot } from '../src/domain/scheduler/ScheduledJobTypes';

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

const loggerFactory = {
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
    expect(keys).toContain('fact-check:2026-06-08T13');
    expect(keys).toContain('state-evolution:2026-06-08T14');
    expect(keys).toContain('state-evolution:2026-06-08T13');
    expect(keys).toContain('fact-check-stats:daily:2026-06-08');
    expect(keys).toContain('fact-check-stats:weekly:2026-W24');
    expect(keys).toContain('fact-check-stats:monthly:2026-06');
    expect(repo.insertDueSlot).toHaveBeenCalledWith(
      expect.anything(),
      5,
      expect.any(String)
    );
  });
});
