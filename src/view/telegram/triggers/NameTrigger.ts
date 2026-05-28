import type { Context } from 'grammy';
import { inject, injectable } from 'inversify';

import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
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
export class NameTrigger implements Trigger<Context> {
  private pattern: RegExp;
  private readonly logger: Logger;
  constructor(
    @inject(ENV_SERVICE_ID) envService: EnvService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.pattern = new RegExp(`^${envService.getBotName()}[,:\\s]`, 'i');
    this.logger = loggerFactory.create('NameTrigger');
    this.logger.debug(
      { pattern: this.pattern },
      'Compiled name trigger pattern'
    );
  }
  async apply(
    _ctx: Context,
    context: TriggerContext
  ): Promise<TriggerResult | null> {
    const text = context.text;
    if (this.pattern.test(text)) {
      context.text = text.replace(this.pattern, '').trim();
      this.logger.debug({ chatId: context.chatId }, 'Name trigger matched');
      return { replyToMessageId: null, reason: null };
    }
    this.logger.debug(
      { chatId: context.chatId, pattern: this.pattern, text },
      'Name trigger not matched'
    );
    return null;
  }
}
