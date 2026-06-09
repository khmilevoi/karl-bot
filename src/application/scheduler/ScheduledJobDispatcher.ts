import { inject, injectable, type ServiceIdentifier } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  SCHEDULED_JOB_REPOSITORY_ID,
  type ScheduledJobRepository,
} from '@/domain/repositories/ScheduledJobRepository';
import type { ScheduledJob } from '@/domain/scheduler/ScheduledJobTypes';

import {
  CRON_WORKER_CONFIG_ID,
  type CronWorkerConfig,
} from './CronWorkerConfig';

export interface ScheduledJobDispatcher {
  start(): void;
  stop(): void;
  dispatchOnce(): Promise<void>;
}

export const SCHEDULED_JOB_DISPATCHER_ID = Symbol.for(
  'ScheduledJobDispatcher'
) as ServiceIdentifier<ScheduledJobDispatcher>;

interface Endpoint {
  path: string;
  body: string;
}

function endpointFor(job: ScheduledJob): Endpoint {
  switch (job.jobName) {
    case 'state-evolution':
      return { path: '/jobs/state-evolution/all', body: '{}' };
    case 'fact-check':
      return { path: '/jobs/fact-check/all', body: '{}' };
    case 'fact-check-stats':
      return { path: '/jobs/fact-check-stats/all', body: job.payloadJson };
  }
}

@injectable()
export class DefaultScheduledJobDispatcher implements ScheduledJobDispatcher {
  private polling = false;
  private readonly logger: Logger;

  constructor(
    @inject(CRON_WORKER_CONFIG_ID) private readonly config: CronWorkerConfig,
    @inject(SCHEDULED_JOB_REPOSITORY_ID)
    private readonly repo: ScheduledJobRepository,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('ScheduledJobDispatcher');
  }

  start(): void {
    if (this.polling) {
      return;
    }
    this.polling = true;
    void this.poll();
  }

  stop(): void {
    this.polling = false;
  }

  async dispatchOnce(): Promise<void> {
    for (;;) {
      const now = new Date().toISOString();
      const lockedUntil = new Date(
        Date.now() + this.config.lockMs
      ).toISOString();
      const job = await this.repo.claimNext(now, lockedUntil);
      if (!job) {
        return;
      }
      await this.runJob(job);
    }
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    const { path, body } = endpointFor(job);
    try {
      const res = await fetch(`${this.config.jobsBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.config.jobRequestTimeoutMs),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      await this.repo.markSucceeded(job.id, new Date().toISOString());
    } catch (error) {
      await this.handleFailure(job, error);
    }
  }

  private async handleFailure(
    job: ScheduledJob,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();

    if (job.attempts >= job.maxAttempts) {
      this.logger.error(
        {
          jobName: job.jobName,
          slotKey: job.slotKey,
          attempts: job.attempts,
          lastError: message,
        },
        'Scheduled job permanently failed'
      );
      await this.repo.markFailed(job.id, message, now);
      return;
    }

    const backoffMs =
      this.config.backoffBaseMs * 2 ** Math.max(0, job.attempts - 1);
    const runAfter = new Date(Date.now() + backoffMs).toISOString();
    await this.repo.scheduleRetry(job.id, runAfter, message, now);
  }

  private async poll(): Promise<void> {
    if (!this.polling) {
      return;
    }
    try {
      await this.dispatchOnce();
    } catch (error) {
      this.logger.error({ error: String(error) }, 'Dispatcher poll error');
    }
    if (this.polling) {
      setTimeout(() => {
        void this.poll();
      }, this.config.pollIntervalMs);
    }
  }
}
