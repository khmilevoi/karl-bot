import type { ServiceIdentifier } from 'inversify';

export interface CronWorkerConfig {
  jobsBaseUrl: string;
  hourlyCron: string;
  dailyStatsCron: string;
  weeklyStatsCron: string;
  monthlyStatsCron: string;
  sweepCron: string;
  timezone: string;
  pollIntervalMs: number;
  reconcileIntervalMs: number;
  lockMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  jobRequestTimeoutMs: number;
}

export const CRON_WORKER_CONFIG_ID = Symbol.for(
  'CronWorkerConfig'
) as ServiceIdentifier<CronWorkerConfig>;
