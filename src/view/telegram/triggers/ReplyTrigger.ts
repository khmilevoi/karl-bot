import type { Context } from 'grammy';
import { inject, injectable } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type {
  Trigger,
  TriggerContext,
  TriggerResult,
} from '@/domain/triggers/Trigger';

@injectable()
export class ReplyTrigger implements Trigger<Context> {
  private readonly logger: Logger;
  constructor(@inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create('ReplyTrigger');
  }
  async apply(
    ctx: Context,
    context: TriggerContext
  ): Promise<TriggerResult | null> {
    const msg = ctx.message as
      | {
          message_id?: number;
          reply_to_message?: { from?: { username?: string } };
        }
      | undefined;
    const reply = msg?.reply_to_message;

    const botUsername = ctx.me?.username;
    if (botUsername && reply?.from?.username === botUsername) {
      this.logger.debug(
        {
          chatId: context.chatId,
          messageId: msg?.message_id,
          username: ctx.from?.username,
        },
        'Reply trigger matched'
      );
      return { replyToMessageId: null, reason: null };
    }
    return null;
  }
}
