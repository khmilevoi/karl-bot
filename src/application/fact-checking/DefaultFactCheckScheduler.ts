import { inject, injectable } from 'inversify';
import cron from 'node-cron';

import {
  CHAT_APPROVAL_SERVICE_ID,
  type ChatApprovalService,
} from '@/application/interfaces/chat/ChatApprovalService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  FACT_CHECK_CONFIG_ID,
  type FactCheckConfig,
} from './FactCheckConfig';
import {
  FACT_CHECK_PIPELINE_ID,
  type FactCheckPipeline,
} from './FactCheckPipeline';
import type { FactCheckScheduler } from './FactCheckScheduler';

@injectable()
export class DefaultFactCheckScheduler implements FactCheckScheduler {
  private readonly logger: Logger;

  constructor(
    @inject(FACT_CHECK_CONFIG_ID) private readonly config: FactCheckConfig,
    @inject(FACT_CHECK_PIPELINE_ID) private readonly pipeline: FactCheckPipeline,
    @inject(CHAT_APPROVAL_SERVICE_ID)
    private readonly chatApproval: ChatApprovalService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('DefaultFactCheckScheduler');
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Fact-check scheduler disabled');
      return;
    }

    this.scheduleHourly();
    this.scheduleStats('daily', this.config.dailyStatsCron);
    this.scheduleStats('weekly', this.config.weeklyStatsCron);
    this.scheduleStats('monthly', this.config.monthlyStatsCron);

    this.logger.info(
      { hourlyCron: this.config.hourlyCron, timezone: this.config.timezone },
      'Fact-check scheduler started'
    );
  }

  private scheduleHourly(): void {
    cron.schedule(
      this.config.hourlyCron,
      () => void this.runHourlyForAllChats(),
      { timezone: this.config.timezone }
    );
  }

  private scheduleStats(
    period: 'daily' | 'weekly' | 'monthly',
    expr: string
  ): void {
    cron.schedule(
      expr,
      () => void this.runStatsForAllChats(period),
      { timezone: this.config.timezone }
    );
  }

  private async runHourlyForAllChats(): Promise<void> {
    const chats = await this.chatApproval.listAll().catch((err: unknown) => {
      this.logger.error({ err }, 'Failed to list chats for fact-check hourly run');
      return [];
    });

    const approved = chats.filter((c) => c.status === 'approved');

    for (const { chatId } of approved) {
      const result = await this.pipeline.runHourly(chatId).catch((err: unknown) => {
        this.logger.error({ err, chatId }, 'Hourly fact-check run threw unexpectedly');
        return null;
      });
      if (result) {
        this.logger.debug({ chatId, outcome: result.outcome }, 'Hourly fact-check run');
      }
    }
  }

  private async runStatsForAllChats(
    period: 'daily' | 'weekly' | 'monthly'
  ): Promise<void> {
    const chats = await this.chatApproval.listAll().catch((err: unknown) => {
      this.logger.error({ err, period }, 'Failed to list chats for fact-check stats run');
      return [];
    });

    const approved = chats.filter((c) => c.status === 'approved');

    for (const { chatId } of approved) {
      await this.pipeline.runStats(chatId, period).catch((err: unknown) => {
        this.logger.error({ err, chatId, period }, 'Stats fact-check run threw unexpectedly');
      });
    }
  }
}
