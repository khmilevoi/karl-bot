import { inject, injectable } from 'inversify';
import cron, { type ScheduledTask } from 'node-cron';

import {
  AI_SERVICE_ID,
  type AIService,
} from '@/application/interfaces/ai/AIService';
import {
  CHAT_CONFIG_SERVICE_ID,
  type ChatConfigService,
} from '@/application/interfaces/chat/ChatConfigService';
import {
  CHAT_INFO_SERVICE_ID,
  type ChatInfoService,
} from '@/application/interfaces/chat/ChatInfoService';
import {
  CHAT_MESSENGER_ID,
  type ChatMessenger,
} from '@/application/interfaces/chat/ChatMessenger';
import {
  CHAT_USER_SERVICE_ID,
  type ChatUserService,
} from '@/application/interfaces/chat/ChatUserService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import { type TopicOfDayScheduler } from '@/application/interfaces/scheduler/TopicOfDayScheduler';
import {
  SUMMARY_SERVICE_ID,
  type SummaryService,
} from '@/application/interfaces/summaries/SummaryService';

@injectable()
export class TopicOfDaySchedulerImpl implements TopicOfDayScheduler {
  private readonly logger: Logger;
  private readonly tasks = new Map<number, ScheduledTask>();
  constructor(
    @inject(CHAT_CONFIG_SERVICE_ID)
    private readonly chatConfig: ChatConfigService,
    @inject(AI_SERVICE_ID) private readonly ai: AIService,
    @inject(CHAT_MESSENGER_ID) private readonly messenger: ChatMessenger,
    @inject(CHAT_USER_SERVICE_ID) private readonly chatUsers: ChatUserService,
    @inject(CHAT_INFO_SERVICE_ID) private readonly chatInfo: ChatInfoService,
    @inject(SUMMARY_SERVICE_ID) private readonly summaries: SummaryService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('TopicOfDayScheduler');
  }

  async start(): Promise<void> {
    const schedules = await this.chatConfig.getTopicOfDaySchedules?.();
    if (!schedules) {
      this.logger.debug('No topic of day schedules');
      return;
    }
    for (const [chatId, { cron: expr, timezone }] of schedules) {
      const tz = this.normalizeTimezone(timezone);
      const task = cron.schedule(expr, () => void this.execute(chatId), {
        timezone: tz,
      });
      this.tasks.set(chatId, task);
      this.logger.debug(
        { chatId, cron: expr, timezone: tz, originalTimezone: timezone },
        'Registered topic of day job'
      );
    }
  }

  async reschedule(chatId: number): Promise<void> {
    const existing = this.tasks.get(chatId);
    if (existing) {
      existing.stop();
      this.tasks.delete(chatId);
      this.logger.debug({ chatId }, 'Unregistered topic of day job');
    }

    const config = await this.chatConfig.getConfig(chatId);
    if (!config.topicTime) return;
    const [hourStr, minuteStr] = config.topicTime.split(':');
    const expr = `0 ${minuteStr} ${hourStr} * * *`;
    const tz = this.normalizeTimezone(config.topicTimezone);
    const task = cron.schedule(expr, () => void this.execute(chatId), {
      timezone: tz,
    });
    this.tasks.set(chatId, task);
    this.logger.debug(
      {
        chatId,
        cron: expr,
        timezone: tz,
        originalTimezone: config.topicTimezone,
      },
      'Registered topic of day job'
    );
  }

  private async execute(chatId: number): Promise<void> {
    try {
      const [users, chat, summary] = await Promise.all([
        this.chatUsers.listUsers(chatId).catch(() => []),
        this.chatInfo.getChat(chatId).catch(() => undefined),
        this.summaries.getSummary(chatId).catch(() => ''),
      ]);
      const mappedUsers = users.map((u) => {
        const parts = [u.firstName, u.lastName].filter(Boolean).join(' ');
        const fullName = parts !== '' ? parts : 'N/A';
        return {
          username: u.username ?? 'N/A',
          fullName,
        };
      });
      const article = await this.ai.generateTopicOfDay({
        chatTitle: chat?.title ?? undefined,
        summary,
        users: mappedUsers,
      });
      if (!article.trim()) {
        this.logger.warn({ chatId }, 'Skipping topic of day: empty content');
        return;
      }
      await this.messenger.sendMessage(chatId, article);
    } catch (err) {
      this.logger.error({ err, chatId }, 'Failed to send topic of day');
    }
  }

  // Converts common UTC offsets like "UTC+02" to valid IANA names for Intl.
  // Leaves known IANA zones (e.g. "Europe/Kyiv" or "UTC") untouched.
  private normalizeTimezone(tz: string): string {
    const trimmed = tz.trim();
    if (
      trimmed.toUpperCase() === 'UTC' ||
      trimmed.toUpperCase() === 'Etc/UTC'
    ) {
      return 'UTC';
    }

    // Match variants: UTC+2, UTC+02, UTC+02:00, GMT-3
    const m = /^(?:UTC|GMT)\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(trimmed);
    if (m) {
      const sign = m[1];
      const hours = parseInt(m[2], 10);
      const minutes = m[3] ? parseInt(m[3], 10) : 0;
      // Intl only supports whole-hour Etc/GMT offsets. If minutes present, drop and warn.
      if (minutes !== 0) {
        this.logger.warn(
          { tz: trimmed },
          'Non-hourly UTC offset provided; minutes will be ignored'
        );
      }
      // Etc/GMT has inverted sign: Etc/GMT-2 corresponds to UTC+2
      const etcSign = sign === '+' ? '-' : '+';
      const etcTz = `Etc/GMT${etcSign}${hours}`;
      return etcTz;
    }

    // Allow plain numeric offsets like +2 or -5
    const n = /^([+-])(\d{1,2})$/.exec(trimmed);
    if (n) {
      const sign = n[1];
      const hours = parseInt(n[2], 10);
      const etcSign = sign === '+' ? '-' : '+';
      return `Etc/GMT${etcSign}${hours}`;
    }

    // Otherwise assume it's a valid IANA TZ name and let cron/Intl validate.
    return trimmed;
  }
}
