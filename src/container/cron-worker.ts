import type { Container } from 'inversify';

import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import {
  CRON_WORKER_CONFIG_ID,
  type CronWorkerConfig,
} from '@/application/scheduler/CronWorkerConfig';
import {
  CRON_SLOT_SCHEDULER_ID,
  DefaultCronSlotScheduler,
  type CronSlotScheduler,
} from '@/application/scheduler/CronSlotScheduler';
import {
  CRON_WORKER_ID,
  DefaultCronWorker,
  type CronWorker,
} from '@/application/scheduler/CronWorker';
import {
  SCHEDULED_JOB_DISPATCHER_ID,
  DefaultScheduledJobDispatcher,
  type ScheduledJobDispatcher,
} from '@/application/scheduler/ScheduledJobDispatcher';
import {
  SCHEDULED_JOB_REPOSITORY_ID,
  type ScheduledJobRepository,
} from '@/domain/repositories/ScheduledJobRepository';
import { SQLiteScheduledJobRepository } from '@/infrastructure/persistence/sqlite/SQLiteScheduledJobRepository';

export const registerCronWorker = (container: Container): void => {
  const envService = container.get<EnvService>(ENV_SERVICE_ID);

  container
    .bind<CronWorkerConfig>(CRON_WORKER_CONFIG_ID)
    .toConstantValue(envService.getCronWorkerConfig());

  container
    .bind<ScheduledJobRepository>(SCHEDULED_JOB_REPOSITORY_ID)
    .to(SQLiteScheduledJobRepository)
    .inSingletonScope();

  container
    .bind<CronSlotScheduler>(CRON_SLOT_SCHEDULER_ID)
    .to(DefaultCronSlotScheduler)
    .inSingletonScope();

  container
    .bind<ScheduledJobDispatcher>(SCHEDULED_JOB_DISPATCHER_ID)
    .to(DefaultScheduledJobDispatcher)
    .inSingletonScope();

  container
    .bind<CronWorker>(CRON_WORKER_ID)
    .to(DefaultCronWorker)
    .inSingletonScope();
};
