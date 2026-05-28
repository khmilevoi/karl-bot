import type { Bot, Context } from 'grammy';
import type { ServiceIdentifier } from 'inversify';

export interface ChatMessenger {
  readonly bot: Bot<Context>;
  sendMessage(chatId: number, text: string, extra?: object): Promise<void>;
  launch(): Promise<void>;
  stop(reason: string): void;
}

export const CHAT_MESSENGER_ID = Symbol.for(
  'ChatMessenger'
) as ServiceIdentifier<ChatMessenger>;
