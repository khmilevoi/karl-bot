import { type ConversationFlavor } from '@grammyjs/conversations';
import { type Context, type SessionFlavor } from 'grammy';

export interface SessionData {
  selectedChatId?: number;
}

type BaseContext = Context & SessionFlavor<SessionData>;

export type BotContext = ConversationFlavor<BaseContext>;
