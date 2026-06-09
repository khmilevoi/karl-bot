import { inject, injectable, type ServiceIdentifier } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';

import {
  CRON_SLOT_SCHEDULER_ID,
  type CronSlotScheduler,
} from './CronSlotScheduler';
import {
  SCHEDULED_JOB_DISPATCHER_ID,
  type ScheduledJobDispatcher,
} from './ScheduledJobDispatcher';

export interface CronWorker {
  start(): void;
  stop(): void;
}

export const CRON_WORKER_ID = Symbol.for(
  'CronWorker'
) as ServiceIdentifier<CronWorker>;

@injectable()
export class DefaultCronWorker implements CronWorker {
  private readonly logger: Logger;

  constructor(
    @inject(CRON_SLOT_SCHEDULER_ID)
    private readonly slotScheduler: CronSlotScheduler,
    @inject(SCHEDULED_JOB_DISPATCHER_ID)
    private readonly dispatcher: ScheduledJobDispatcher,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('CronWorker');
  }

  start(): void {
    this.slotScheduler.start();
    this.dispatcher.start();
    this.logger.info('Cron worker started');
  }

  stop(): void {
    this.dispatcher.stop();
    this.slotScheduler.stop();
    this.logger.info('Cron worker stopped');
  }
}
