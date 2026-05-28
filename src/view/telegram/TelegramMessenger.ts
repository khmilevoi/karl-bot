import { conversations } from '@grammyjs/conversations';
import { Bot, type Context, GrammyError, HttpError, session } from 'grammy';
import { inject, injectable } from 'inversify';

import type { ChatMessenger } from '@/application/interfaces/chat/ChatMessenger';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';

import type { BotContext, SessionData } from './context';

@injectable()
export class TelegramMessenger implements ChatMessenger {
  private readonly _bot: Bot<BotContext>;
  private readonly logger: Logger;

  get bot(): Bot<Context> {
    return this._bot as unknown as Bot<Context>;
  }

  constructor(
    @inject(ENV_SERVICE_ID) envService: EnvService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this._bot = new Bot<BotContext>(envService.env.BOT_TOKEN);
    this._bot.use(
      session<SessionData, BotContext>({ initial: (): SessionData => ({}) })
    );
    this._bot.use(conversations());
    this.logger = loggerFactory.create('TelegramMessenger');
    this._bot.catch((err) => {
      const { error } = err;
      if (error instanceof GrammyError && error.error_code === 400) {
        this.logger.warn({ err: error }, 'Ignoring 400 Telegram API error');
        return;
      }
      if (error instanceof HttpError) {
        this.logger.warn({ err: error }, 'Ignoring HTTP error');
        return;
      }
      this.logger.error({ err }, 'Unhandled bot error');
    });
  }

  async launch(): Promise<void> {
    this.logger.info('Launching bot');
    await this._bot.api
      .deleteWebhook()
      .catch((err) =>
        this.logger.warn({ err }, 'Failed to delete existing webhook')
      );
    void this._bot
      .start({ onStart: () => this.logger.info('Bot launched') })
      .catch((err) => this.logger.error({ err }, 'Failed to launch bot'));
  }

  stop(reason: string): void {
    this.logger.info({ reason }, 'Stopping bot');
    void this._bot.stop();
  }

  async sendMessage(
    chatId: number,
    text: string,
    extra?: object
  ): Promise<void> {
    await this._bot.api.sendMessage(chatId, text, extra);
  }
}
