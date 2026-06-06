import { inject, injectable } from 'inversify';

import type { FactCheckWindowEntity } from '@/domain/entities/FactCheckWindowEntity';
import type { FactCheckWindowRepository } from '@/domain/repositories/FactCheckWindowRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';

interface WindowRow {
  chat_id: number;
  last_checked_message_id: number;
  last_checked_at: string | null;
  updated_at: string;
}

@injectable()
export class SQLiteFactCheckWindowRepository
  implements FactCheckWindowRepository
{
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async get(chatId: number): Promise<FactCheckWindowEntity | null> {
    const db = await this.dbProvider.get();
    const row = await db.get<WindowRow>(
      'SELECT chat_id, last_checked_message_id, last_checked_at, updated_at FROM fact_check_windows WHERE chat_id = ?',
      chatId
    );
    if (!row) return null;
    return {
      chatId: row.chat_id,
      lastCheckedMessageId: row.last_checked_message_id,
      lastCheckedAt: row.last_checked_at,
      updatedAt: row.updated_at,
    };
  }

  async upsert(window: FactCheckWindowEntity): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      'INSERT INTO fact_check_windows (chat_id, last_checked_message_id, last_checked_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET last_checked_message_id=excluded.last_checked_message_id, last_checked_at=excluded.last_checked_at, updated_at=excluded.updated_at',
      window.chatId,
      window.lastCheckedMessageId,
      window.lastCheckedAt,
      window.updatedAt
    );
  }
}
