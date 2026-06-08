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
