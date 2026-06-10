import { inject, injectable, type ServiceIdentifier } from 'inversify';
import cron, { type ScheduledTask } from 'node-cron';

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
