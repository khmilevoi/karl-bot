import { inject, injectable } from 'inversify';

import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { StoredMessage } from '@/domain/messages/StoredMessage';
import type {
  MessageProcessingStatus,
  MessageSourceType,
} from '@/domain/voice/VoiceTypes';
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
  reply_to_message_id: number | null;
  reply_to_user_id: number | null;
  user_id: number | null;
  chat_id: number | null;
  message_id: number | null;
  source_type: MessageSourceType;
  processing_status: MessageProcessingStatus;
}

const SELECT_MESSAGE_COLUMNS =
  'SELECT m.id, m.role, m.content, u.username, u.first_name, u.last_name, m.reply_text, m.reply_username, m.quote_text, m.reply_to_message_id, m.reply_to_user_id, m.user_id, c.chat_id, m.message_id, m.source_type, m.processing_status FROM messages m LEFT JOIN users u ON m.user_id = u.id LEFT JOIN chats c ON m.chat_id = c.chat_id';

function rowToMessage(r: MessageRow): StoredMessage {
  const entry: StoredMessage = {
    id: r.id,
    role: r.role,
    content: r.content,
    chatId: r.chat_id ?? 0,
  };
  if (r.username) entry.username = r.username;
  if (r.first_name) entry.firstName = r.first_name;
  if (r.last_name) entry.lastName = r.last_name;
  const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ');
  if (fullName) entry.fullName = fullName;
  if (r.reply_text) entry.replyText = r.reply_text;
  if (r.reply_username) entry.replyUsername = r.reply_username;
  if (r.quote_text) entry.quoteText = r.quote_text;
  if (r.reply_to_message_id != null)
    entry.replyToMessageId = r.reply_to_message_id;
  if (r.reply_to_user_id != null) entry.replyToUserId = r.reply_to_user_id;
  if (r.user_id) entry.userId = r.user_id;
  if (r.message_id) entry.messageId = r.message_id;
  entry.sourceType = r.source_type;
  entry.processingStatus = r.processing_status;
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
    replyToMessageId,
    replyToUserId,
    sourceType,
    processingStatus,
  }: StoredMessage): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      'INSERT INTO messages (chat_id, message_id, role, content, user_id, reply_text, reply_username, quote_text, reply_to_message_id, reply_to_user_id, source_type, processing_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      chatId,
      messageId ?? null,
      role,
      content,
      userId ?? 0,
      replyText ?? null,
      replyUsername ?? null,
      quoteText ?? null,
      replyToMessageId ?? null,
      replyToUserId ?? null,
      sourceType ?? 'text',
      processingStatus ?? 'ready'
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async findByChatId(chatId: number): Promise<ChatMessage[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.chat_id = ? AND m.is_active = 1 AND m.processing_status = 'ready' ORDER BY m.id`,
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
      `${SELECT_MESSAGE_COLUMNS} WHERE m.id IN (${placeholders}) AND m.is_active = 1 AND m.processing_status = 'ready' ORDER BY m.id ASC`,
      ...ids
    );
    return (rows ?? []).map(rowToMessage);
  }

  async countByChatId(chatId: number): Promise<number> {
    const db = await this.dbProvider.get();
    const row = await db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM messages WHERE chat_id = ? AND is_active = 1 AND processing_status = 'ready'",
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
      `${SELECT_MESSAGE_COLUMNS} WHERE m.chat_id = ? AND m.is_active = 1 AND m.processing_status = 'ready' ORDER BY m.id DESC LIMIT ?`,
      chatId,
      limit
    );
    return (rows ?? []).map(rowToMessage);
  }

  async clearByChatId(chatId: number): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run('UPDATE messages SET is_active = 0 WHERE chat_id = ?', chatId);
  }

  async findPendingVoiceById(messageId: number): Promise<StoredMessage | null> {
    const db = await this.dbProvider.get();
    const row = await db.get<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.id = ? AND m.is_active = 1 AND m.source_type = 'voice' AND m.processing_status = 'pending'`,
      messageId
    );
    return row != null ? rowToMessage(row) : null;
  }

  async markVoiceTranscribed(
    messageId: number,
    content: string
  ): Promise<StoredMessage | null> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      "UPDATE messages SET content = ?, processing_status = 'ready' WHERE id = ? AND is_active = 1 AND source_type = 'voice' AND processing_status = 'pending'",
      content,
      messageId
    )) as { changes?: number };
    if ((result.changes ?? 0) === 0) {
      return null;
    }
    return this.findReadyVoiceById(messageId);
  }

  async markVoiceFailed(messageId: number): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      "UPDATE messages SET processing_status = 'failed' WHERE id = ? AND is_active = 1 AND source_type = 'voice' AND processing_status = 'pending'",
      messageId
    );
  }

  private async findReadyVoiceById(
    messageId: number
  ): Promise<StoredMessage | null> {
    const db = await this.dbProvider.get();
    const row = await db.get<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.id = ? AND m.is_active = 1 AND m.source_type = 'voice' AND m.processing_status = 'ready'`,
      messageId
    );
    return row != null ? rowToMessage(row) : null;
  }
}
