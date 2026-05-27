import type { Context } from 'grammy';
import type { Message } from 'grammy/types';
import { injectable } from 'inversify';

import {
  type MessageContext,
  type MessageContextExtractor,
} from '@/application/interfaces/messages/MessageContextExtractor';

@injectable()
export class DefaultMessageContextExtractor implements MessageContextExtractor {
  extract(ctx: Context): MessageContext {
    type MessageWithQuote = Message & {
      reply_to_message?: Record<string, unknown>;
      quote?: { text?: string };
    };

    const message = ctx.message as MessageWithQuote | undefined;

    let replyText: string | undefined;
    let replyUsername: string | undefined;
    let quoteText: string | undefined;

    if (message?.reply_to_message) {
      const pieces: string[] = [];
      const reply = message.reply_to_message as Record<string, unknown>;
      if (typeof reply.text === 'string') {
        pieces.push(reply.text);
      }
      if (typeof reply.caption === 'string') {
        pieces.push(reply.caption);
      }
      if (pieces.length > 0) {
        replyText = pieces.join('; ');
      }

      const from = message.reply_to_message.from as
        | { first_name?: string; last_name?: string; username?: string }
        | undefined;
      if (from) {
        if (from.first_name && from.last_name) {
          replyUsername = from.first_name + ' ' + from.last_name;
        } else {
          replyUsername = from.first_name ?? from.username;
        }
      }
    }

    if (typeof message?.quote?.text === 'string') {
      quoteText = message.quote.text;
    }

    const username = ctx.from?.username ?? 'Имя неизвестно';
    const fullName =
      ctx.from?.first_name && ctx.from?.last_name
        ? ctx.from.first_name + ' ' + ctx.from.last_name
        : (ctx.from?.first_name ?? ctx.from?.last_name ?? username);

    return { replyText, replyUsername, quoteText, username, fullName };
  }
}
