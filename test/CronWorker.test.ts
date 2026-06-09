import { describe, expect, it, vi } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { CronSlotScheduler } from '../src/application/scheduler/CronSlotScheduler';
import { DefaultCronWorker } from '../src/application/scheduler/CronWorker';
import type { ScheduledJobDispatcher } from '../src/application/scheduler/ScheduledJobDispatcher';

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
