import { inject, injectable } from 'inversify';
import cron from 'node-cron';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  JOB_RUNNER_ID,
  type JobRunner,
  type StatsPeriod,
} from '@/application/interfaces/scheduler/JobRunner';

import { FACT_CHECK_CONFIG_ID, type FactCheckConfig } from './FactCheckConfig';
import type { FactCheckScheduler } from './FactCheckScheduler';

@injectable()
export class DefaultFactCheckScheduler implements FactCheckScheduler {
  private readonly logger: Logger;

  constructor(
    @inject(FACT_CHECK_CONFIG_ID) private readonly config: FactCheckConfig,
    @inject(JOB_RUNNER_ID) private readonly jobRunner: JobRunner,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('DefaultFactCheckScheduler');
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Fact-check scheduler disabled');
      return;
    }

    cron.schedule(this.config.hourlyCron, () => void this.runHourly(), {
      timezone: this.config.timezone,
    });
    this.scheduleStats('daily', this.config.dailyStatsCron);
    this.scheduleStats('weekly', this.config.weeklyStatsCron);
    this.scheduleStats('monthly', this.config.monthlyStatsCron);

    this.logger.info(
      { hourlyCron: this.config.hourlyCron, timezone: this.config.timezone },
      'Fact-check scheduler started'
    );
  }

  private scheduleStats(period: StatsPeriod, expr: string): void {
    cron.schedule(expr, () => void this.runStats(period), {
      timezone: this.config.timezone,
    });
  }

  private async runHourly(): Promise<void> {
    const result = await this.jobRunner
      .runForAllChats({ job: 'fact-check' })
      .catch((err: unknown) => {
        this.logger.error({ err }, 'Hourly fact-check run failed');
        return null;
      });
    if (result && 'totalChats' in result) {
      this.logger.debug(
        { totalChats: result.totalChats },
        'Hourly fact-check run complete'
      );
    }
  }

  private async runStats(period: StatsPeriod): Promise<void> {
    const result = await this.jobRunner
      .runForAllChats({ job: 'fact-check-stats', period })
      .catch((err: unknown) => {
        this.logger.error({ err, period }, 'Stats fact-check run failed');
        return null;
      });
    if (result && 'totalChats' in result) {
      this.logger.debug(
        { period, totalChats: result.totalChats },
        'Stats fact-check run complete'
      );
    }
  }
}
