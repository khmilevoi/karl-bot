import type { ChatMessage } from './ChatMessage';

export interface StoredMessage extends ChatMessage {
  chatId: number;
  messageId?: number;
  chatTitle?: string;
  chatUsername?: string;
}
