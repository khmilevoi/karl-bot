import { inject, injectable } from 'inversify';

import type { ChatConfigEntity } from '@/domain/entities/ChatConfigEntity';
import type { ChatConfigRepository } from '@/domain/repositories/ChatConfigRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';

@injectable()
export class SQLiteChatConfigRepository implements ChatConfigRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async upsert({
    chatId,
    historyLimit,
    topicTime,
    topicTimezone,
  }: ChatConfigEntity): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      'INSERT INTO chat_configs (chat_id, history_limit, topic_time, topic_timezone) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET history_limit=excluded.history_limit, topic_time=excluded.topic_time, topic_timezone=excluded.topic_timezone',
      chatId,
      historyLimit,
      topicTime,
      topicTimezone
    );
  }

  async findById(chatId: number): Promise<ChatConfigEntity | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<{
      chat_id: number;
      history_limit: number;
      topic_time: string | null;
      topic_timezone: string;
    }>(
      'SELECT chat_id, history_limit, topic_time, topic_timezone FROM chat_configs WHERE chat_id = ?',
      chatId
    );
    return row
      ? {
          chatId: row.chat_id,
          historyLimit: row.history_limit,
          topicTime: row.topic_time,
          topicTimezone: row.topic_timezone,
        }
      : undefined;
  }

  async findAll(): Promise<ChatConfigEntity[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<{
      chat_id: number;
      history_limit: number;
      topic_time: string | null;
      topic_timezone: string;
    }>(
      'SELECT chat_id, history_limit, topic_time, topic_timezone FROM chat_configs'
    );
    return rows.map((row) => ({
      chatId: row.chat_id,
      historyLimit: row.history_limit,
      topicTime: row.topic_time,
      topicTimezone: row.topic_timezone,
    }));
  }
}
