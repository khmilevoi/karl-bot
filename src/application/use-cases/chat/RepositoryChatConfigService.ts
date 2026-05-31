import { inject, injectable } from 'inversify';

import { type ChatConfigService } from '@/application/interfaces/chat/ChatConfigService';
import {
  InvalidHistoryLimitError,
  InvalidTopicTimeError,
} from '@/application/interfaces/chat/ChatConfigService.errors';
import type { ChatConfigEntity } from '@/domain/entities/ChatConfigEntity';
import {
  CHAT_CONFIG_REPOSITORY_ID,
  type ChatConfigRepository,
} from '@/domain/repositories/ChatConfigRepository';

const DEFAULT_HISTORY_LIMIT = 50;
const DEFAULT_TOPIC_TIME = '09:00';
const DEFAULT_TOPIC_TIMEZONE = 'UTC';
const TOPIC_TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

@injectable()
export class RepositoryChatConfigService implements ChatConfigService {
  constructor(
    @inject(CHAT_CONFIG_REPOSITORY_ID) private repo: ChatConfigRepository
  ) {}

  async getConfig(chatId: number): Promise<ChatConfigEntity> {
    let config = await this.repo.findById(chatId);
    if (!config) {
      config = {
        chatId,
        historyLimit: DEFAULT_HISTORY_LIMIT,
        topicTime: DEFAULT_TOPIC_TIME,
        topicTimezone: DEFAULT_TOPIC_TIMEZONE,
      };
      await this.repo.upsert(config);
    }
    return config;
  }

  async setHistoryLimit(chatId: number, historyLimit: number): Promise<void> {
    if (
      !Number.isInteger(historyLimit) ||
      historyLimit <= 0 ||
      historyLimit > 50
    ) {
      throw new InvalidHistoryLimitError('Invalid history limit');
    }
    const config = await this.getConfig(chatId);
    await this.repo.upsert({ ...config, historyLimit });
  }

  async getTopicOfDaySchedules(): Promise<
    Map<number, { cron: string; timezone: string }>
  > {
    const configs = await this.repo.findAll();
    const schedules = new Map<number, { cron: string; timezone: string }>();
    for (const { chatId, topicTime, topicTimezone } of configs) {
      if (!topicTime) continue;
      const [hourStr, minuteStr] = topicTime.split(':');
      const cron = `0 ${minuteStr} ${hourStr} * * *`;
      schedules.set(chatId, { cron, timezone: topicTimezone });
    }
    return schedules;
  }

  async setTopicTime(
    chatId: number,
    topicTime: string | null,
    topicTimezone: string
  ): Promise<void> {
    if (topicTime !== null && !TOPIC_TIME_REGEX.test(topicTime)) {
      throw new InvalidTopicTimeError('Invalid topic time');
    }
    const config = await this.getConfig(chatId);
    await this.repo.upsert({ ...config, topicTime, topicTimezone });
  }
}
