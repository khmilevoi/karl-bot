import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { StoredMessage } from '@/domain/messages/StoredMessage';

export interface MessageRepository {
  insert(message: StoredMessage): Promise<number>;
  findByChatId(chatId: number): Promise<ChatMessage[]>;
  findByIds(ids: readonly number[]): Promise<ChatMessage[]>;
  countByChatId(chatId: number): Promise<number>;
  findLastByChatId(chatId: number, limit: number): Promise<ChatMessage[]>;
  clearByChatId(chatId: number): Promise<void>;
  findPendingVoiceById(messageId: number): Promise<StoredMessage | null>;
  markVoiceTranscribed(
    messageId: number,
    content: string
  ): Promise<StoredMessage | null>;
  markVoiceFailed(messageId: number): Promise<void>;
}

export const MESSAGE_REPOSITORY_ID = Symbol('MessageRepository');
