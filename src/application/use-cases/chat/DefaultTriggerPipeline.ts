import type { Context } from 'grammy';
import { inject, injectable, multiInject } from 'inversify';

import {
  DIALOGUE_MANAGER_ID,
  type DialogueManager,
} from '@/application/interfaces/chat/DialogueManager';
import { type TriggerPipeline } from '@/application/interfaces/chat/TriggerPipeline';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type { TriggerContext, TriggerResult } from '@/domain/triggers/Trigger';
import { type Trigger, TRIGGER_ID } from '@/domain/triggers/Trigger';

@injectable()
export class DefaultTriggerPipeline implements TriggerPipeline {
  private readonly logger: Logger;

  constructor(
    @inject(DIALOGUE_MANAGER_ID) private dialogue: DialogueManager,
    @multiInject(TRIGGER_ID) private triggers: Trigger<Context>[],
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('DefaultTriggerPipeline');
  }

  async shouldRespond(
    ctx: Context,
    context: TriggerContext
  ): Promise<TriggerResult | null> {
    const chatId = context.chatId;
    const inDialogue = this.dialogue.isActive(chatId);
    let matchedTrigger: string | null = null;
    let result: TriggerResult | null = null;

    for (const trigger of this.triggers) {
      result = await trigger.apply(ctx, context);
      if (result) {
        matchedTrigger = trigger.constructor.name;
        break;
      }
    }

    const matched = matchedTrigger !== null;
    if (matched) {
      if (inDialogue) {
        this.dialogue.extend(chatId);
      } else {
        this.dialogue.start(chatId);
      }
      this.logger.debug({ chatId, trigger: matchedTrigger }, 'Trigger matched');
    } else {
      this.logger.debug({ chatId }, 'No trigger matched');
    }

    return result;
  }
}
