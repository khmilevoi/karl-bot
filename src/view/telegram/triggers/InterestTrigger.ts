import type { Context } from 'grammy';
import { inject, injectable } from 'inversify';

import {
  DIALOGUE_MANAGER_ID,
  type DialogueManager,
} from '@/application/interfaces/chat/DialogueManager';
import {
  INTEREST_CHECKER_ID,
  type InterestChecker,
} from '@/application/interfaces/interest/InterestChecker';
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
export class InterestTrigger implements Trigger<Context> {
  private readonly logger: Logger;
  constructor(
    @inject(INTEREST_CHECKER_ID) private checker: InterestChecker,
    @inject(DIALOGUE_MANAGER_ID) private dialogue: DialogueManager,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('InterestTrigger');
  }

  async apply(
    _ctx: Context,
    { chatId }: TriggerContext
  ): Promise<TriggerResult | null> {
    if (this.dialogue.isActive(chatId)) {
      this.logger.debug(
        { chatId },
        'Interest trigger suppressed because dialogue is active'
      );
      return null;
    }

    const result = await this.checker.check(chatId);
    if (result) {
      this.logger.debug({ chatId }, 'Interest trigger matched');
      return {
        replyToMessageId: result.messageId ? Number(result.messageId) : null,
        reason: { message: result.message, why: result.why },
      };
    }
    this.logger.debug(
      { chatId },
      'Interest trigger suppressed because interest check returned null'
    );
    return null;
  }
}
