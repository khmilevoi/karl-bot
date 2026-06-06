import { inject, injectable } from 'inversify';

import {
  CHAT_MESSENGER_ID,
  type ChatMessenger,
} from '@/application/interfaces/chat/ChatMessenger';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  FACT_CHECK_FINDING_REPOSITORY_ID,
  type FactCheckFindingRepository,
} from '@/domain/repositories/FactCheckRepository';
import {
  FACT_CHECK_CONFIG_ID,
  type FactCheckConfig,
} from './FactCheckConfig';
import {
  formatImmediateFactCheck,
  formatHourlyDigest,
} from './FactCheckFormatter';
import {
  FACT_CHECK_STATS_SERVICE_ID,
  type FactCheckStatsService,
} from './FactCheckStatsService';
import type { FactCheckNotifier } from './FactCheckNotifier';

@injectable()
export class DefaultFactCheckNotifier implements FactCheckNotifier {
  private readonly logger: Logger;

  constructor(
    @inject(FACT_CHECK_FINDING_REPOSITORY_ID)
    private readonly findingRepo: FactCheckFindingRepository,
    @inject(FACT_CHECK_CONFIG_ID) private readonly config: FactCheckConfig,
    @inject(CHAT_MESSENGER_ID) private readonly messenger: ChatMessenger,
    @inject(FACT_CHECK_STATS_SERVICE_ID)
    private readonly statsService: FactCheckStatsService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('DefaultFactCheckNotifier');
  }

  async sendImmediate(chatId: number): Promise<void> {
    const findings = await this.findingRepo.findUnsentImmediate(chatId, 10);
    const now = new Date().toISOString();

    for (const finding of findings) {
      try {
        const text = formatImmediateFactCheck(finding);
        await this.messenger.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        await this.findingRepo.markImmediateNotified(finding.id, now);
      } catch (err) {
        this.logger.warn({ err, findingId: finding.id }, 'Immediate send failed');
        await this.findingRepo
          .recordNotificationError(
            finding.id,
            err instanceof Error ? err.message : String(err)
          )
          .catch(() => undefined);
      }
    }
  }

  async sendHourlyDigest(chatId: number): Promise<void> {
    const findings = await this.findingRepo.findUnsentDigest(
      chatId,
      this.config.maxFindingsPerDigestMessage * 3
    );

    if (findings.length === 0) return;

    const chunks = formatHourlyDigest(findings, this.config);
    const now = new Date().toISOString();

    for (const chunk of chunks) {
      try {
        await this.messenger.sendMessage(chatId, chunk, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      } catch (err) {
        this.logger.warn({ err }, 'Digest chunk send failed');
      }
    }

    const ids = findings.map((f) => f.id);
    await this.findingRepo.markDigestNotified(ids, now).catch((err: unknown) => {
      this.logger.warn({ err }, 'markDigestNotified failed');
    });
  }

  async sendStats(
    chatId: number,
    period: 'daily' | 'weekly' | 'monthly'
  ): Promise<void> {
    try {
      const text = await this.statsService.getStatsSummary(chatId, period);
      await this.messenger.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (err) {
      this.logger.warn({ err }, 'Stats send failed');
    }
  }
}
