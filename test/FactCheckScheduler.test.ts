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
