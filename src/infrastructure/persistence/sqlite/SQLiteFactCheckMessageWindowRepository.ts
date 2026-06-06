import { inject, injectable } from 'inversify';

import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { FactCheckMessageWindowRepository } from '@/domain/repositories/FactCheckMessageWindowRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import {
  SELECT_MESSAGE_COLUMNS,
  rowToMessage,
  type MessageRow,
} from '@/infrastructure/persistence/sqlite/SQLiteMessageRepository';

@injectable()
export class SQLiteFactCheckMessageWindowRepository
  implements FactCheckMessageWindowRepository
{
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async findReadyByChatIdAfterId(
    chatId: number,
    afterId: number,
    limit: number
  ): Promise<ChatMessage[]> {
    const db = await this.dbProvider.get();
    // Stop-at-hole: never return a ready message at or beyond the first still
    // `pending` message id (a voice message mid-transcription). Its DB id is
    // already assigned, so if we processed past it the watermark would advance
    // beyond it and it would never be fact-checked once it flips to `ready`
    // (the leapfrog bug). `failed` is terminal and intentionally NOT a hole, so
    // a permanently-failed voice message does not freeze the chat. COALESCE to
    // a max-bigint sentinel when there is no pending hole.
    const rows = await db.all<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.chat_id = ? AND m.id > ? AND m.is_active = 1 AND m.processing_status = 'ready' AND m.id < COALESCE((SELECT MIN(id) FROM messages WHERE chat_id = ? AND is_active = 1 AND processing_status = 'pending' AND id > ?), 9223372036854775807) ORDER BY m.id ASC LIMIT ?`,
      chatId,
      afterId,
      chatId,
      afterId,
      limit
    );
    return (rows ?? []).map(rowToMessage);
  }

  async findReadyContextBeforeId(
    chatId: number,
    beforeId: number,
    limit: number
  ): Promise<ChatMessage[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.chat_id = ? AND m.id < ? AND m.is_active = 1 AND m.processing_status = 'ready' ORDER BY m.id DESC LIMIT ?`,
      chatId,
      beforeId,
      limit
    );
    return (rows ?? []).map(rowToMessage).reverse();
  }
}
