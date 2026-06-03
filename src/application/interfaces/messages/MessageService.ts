import type { ServiceIdentifier } from 'inversify';

import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { StoredMessage } from '@/domain/messages/StoredMessage';

export interface MessageService {
  addMessage(message: StoredMessage): Promise<number>;
  getMessages(chatId: number): Promise<ChatMessage[]>;
  getMessagesByIds(ids: readonly number[]): Promise<ChatMessage[]>;
  getCount(chatId: number): Promise<number>;
  getLastMessages(chatId: number, limit: number): Promise<ChatMessage[]>;
  clearMessages(chatId: number): Promise<void>;
  findPendingVoiceById(messageId: number): Promise<StoredMessage | null>;
  markVoiceTranscribed(
    messageId: number,
    content: string
  ): Promise<StoredMessage | null>;
  markVoiceFailed(messageId: number): Promise<void>;
}

export const MESSAGE_SERVICE_ID = Symbol.for(
  'MessageService'
) as ServiceIdentifier<MessageService>;
