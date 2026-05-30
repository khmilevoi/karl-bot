export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  username?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  replyText?: string;
  replyUsername?: string;
  quoteText?: string;
  userId?: number;
  // Telegram message_id. Do not use this for behavior evidence references.
  messageId?: number;
  chatId?: number;
  attitude?: string | null;
}
