import { inject, injectable } from 'inversify';

import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { StoredMessage } from '@/domain/messages/StoredMessage';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { MessageRepository } from '@/domain/repositories/MessageRepository';

interface MessageRow {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  reply_text: string | null;
  reply_username: string | null;
  quote_text: string | null;
  user_id: number | null;
  chat_id: number | null;
  message_id: number | null;
}

const SELECT_MESSAGE_COLUMNS =
  'SELECT m.id, m.role, m.content, u.username, u.first_name, u.last_name, m.reply_text, m.reply_username, m.quote_text, m.user_id, c.chat_id, m.message_id FROM messages m LEFT JOIN users u ON m.user_id = u.id LEFT JOIN chats c ON m.chat_id = c.chat_id';

function rowToMessage(r: MessageRow): ChatMessage {
  const entry: ChatMessage = {
    id: r.id,
    role: r.role,
    content: r.content,
    chatId: r.chat_id ?? undefined,
  };
  if (r.username) entry.username = r.username;
  if (r.first_name) entry.firstName = r.first_name;
  if (r.last_name) entry.lastName = r.last_name;
  const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ');
  if (fullName) entry.fullName = fullName;
  if (r.reply_text) entry.replyText = r.reply_text;
  if (r.reply_username) entry.replyUsername = r.reply_username;
  if (r.quote_text) entry.quoteText = r.quote_text;
  if (r.user_id) entry.userId = r.user_id;
  if (r.message_id) entry.messageId = r.message_id;
  return entry;
}

@injectable()
export class SQLiteMessageRepository implements MessageRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async insert({
    chatId,
    messageId,
    role,
    content,
    userId,
    replyText,
    replyUsername,
    quoteText,
  }: StoredMessage): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      'INSERT INTO messages (chat_id, message_id, role, content, user_id, reply_text, reply_username, quote_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      chatId,
      messageId ?? null,
      role,
      content,
      userId ?? 0,
      replyText ?? null,
      replyUsername ?? null,
      quoteText ?? null
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async findByChatId(chatId: number): Promise<ChatMessage[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.chat_id = ? AND m.is_active = 1 ORDER BY m.id`,
      chatId
    );
    return (rows ?? []).map(rowToMessage);
  }

  async findByIds(ids: readonly number[]): Promise<ChatMessage[]> {
    if (ids.length === 0) {
      return [];
    }
    const db = await this.dbProvider.get();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await db.all<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.id IN (${placeholders}) ORDER BY m.id ASC`,
      ...ids
    );
    return (rows ?? []).map(rowToMessage);
  }

  async countByChatId(chatId: number): Promise<number> {
    const db = await this.dbProvider.get();
    const row = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM messages WHERE chat_id = ? AND is_active = 1',
      chatId
    );
    return row?.count ?? 0;
  }

  async findLastByChatId(
    chatId: number,
    limit: number
  ): Promise<ChatMessage[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.chat_id = ? AND m.is_active = 1 ORDER BY m.id DESC LIMIT ?`,
      chatId,
      limit
    );
    return (rows ?? []).map(rowToMessage);
  }

  async clearByChatId(chatId: number): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run('UPDATE messages SET is_active = 0 WHERE chat_id = ?', chatId);
  }
}
