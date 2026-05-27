import type { Context } from 'grammy';
import { inject, injectable } from 'inversify';

import {
  DIALOGUE_MANAGER_ID,
  type DialogueManager,
} from '@/application/interfaces/chat/DialogueManager';
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
export class MentionTrigger implements Trigger<Context> {
  private readonly logger: Logger;
  constructor(
    @inject(DIALOGUE_MANAGER_ID) private dialogue: DialogueManager,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('MentionTrigger');
  }
  async apply(
    ctx: Context,
    context: TriggerContext
  ): Promise<TriggerResult | null> {
    const msg = ctx.message as Record<string, unknown> | undefined;
    const text = typeof msg?.text === 'string' ? msg.text : '';
    const botUsername = ctx.me?.username ?? '';
    const mention = `@${botUsername}`;
    const index = text.indexOf(mention);
    if (index !== -1) {
      const snippet = text.slice(
        Math.max(0, index - 20),
        Math.min(text.length, index + mention.length + 20)
      );
      context.text = text.replace(mention, '').trim();
      const dialogueState = this.dialogue.isActive(context.chatId)
        ? 'active'
        : 'inactive';
      this.logger.debug(
        { chatId: context.chatId, snippet, dialogueState },
        'Mention trigger matched'
      );
      return { replyToMessageId: null, reason: null };
    }
    return null;
  }
}
