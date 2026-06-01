import { inject, injectable } from 'inversify';
import pino, {
  type LevelWithSilent,
  type Logger as Pino,
  type LoggerOptions,
} from 'pino';

import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import { type LoggerFactory } from '@/application/interfaces/logging/LoggerFactory';

import { PinoLogger } from './PinoLogger';

@injectable()
export class PinoLoggerFactory implements LoggerFactory {
  private readonly root: Pino;

  constructor(@inject(ENV_SERVICE_ID) private readonly envService: EnvService) {
    const level: LevelWithSilent =
      (this.envService.env.LOG_LEVEL as LevelWithSilent | undefined) ??
      (process.env.LOG_LEVEL as LevelWithSilent | undefined) ??
      'info';
    const options: LoggerOptions = {
      level,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, sync: true },
      },
    };
    this.root = pino(options);
  }

  create(serviceName: string): Logger {
    return new PinoLogger(
      this.envService,
      this.root.child({ service: serviceName })
    );
  }
}
