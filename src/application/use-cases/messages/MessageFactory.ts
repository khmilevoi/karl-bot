import assert from 'node:assert';

import type { Context } from 'grammy';

import type { MessageContext } from '@/application/interfaces/messages/MessageContextExtractor';
import type { StoredMessage } from '@/domain/messages/StoredMessage';

export class MessageFactory {
  static fromUser(ctx: Context, meta: MessageContext): StoredMessage {
    const message = ctx.message as { text?: string } | undefined;
    const text = message?.text;
    assert(typeof text === 'string', 'Нет текста сообщения');

    const { replyText, replyUsername, quoteText, username, fullName } = meta;

    const chatId = ctx.chat?.id;
    assert(chatId, 'No chat id');
    const chatTitle =
      ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined;

    return {
      role: 'user',
      content: text,
      username,
      fullName,
      replyText,
      replyUsername,
      quoteText,
      userId: ctx.from?.id,
      messageId: ctx.message?.message_id,
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
      chatId,
      chatTitle,
    };
  }

  static fromAssistant(ctx: Context, content: string): StoredMessage {
    const chatId = ctx.chat?.id;
    assert(chatId, 'No chat id');
    const chatTitle =
      ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined;

    return {
      role: 'assistant',
      content,
      username: ctx.me.username,
      chatId,
      chatTitle,
    };
  }
}
