import type { ServiceIdentifier } from 'inversify';

import type { ChatConfigEntity } from '@/domain/entities/ChatConfigEntity';

export interface ChatConfigService {
  getConfig(chatId: number): Promise<ChatConfigEntity>;
  setHistoryLimit(chatId: number, historyLimit: number): Promise<void>;
  setTopicTime(
    chatId: number,
    topicTime: string | null,
    topicTimezone: string
  ): Promise<void>;
  getTopicOfDaySchedules?(): Promise<
    Map<number, { cron: string; timezone: string }>
  >;
}

export const CHAT_CONFIG_SERVICE_ID = Symbol.for(
  'ChatConfigService'
) as ServiceIdentifier<ChatConfigService>;
