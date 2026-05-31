import { inject, injectable } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';

import {
  STATE_EVOLUTION_PASS_ID,
  type StateEvolutionPass,
} from './StateEvolutionPass';
import type { StateEvolutionWorker } from './StateEvolutionWorker';

interface ChatState {
  running: boolean;
  rerun: boolean;
}

@injectable()
export class DefaultStateEvolutionWorker implements StateEvolutionWorker {
  private readonly chatStates = new Map<number, ChatState>();
  private readonly logger: Logger;

  constructor(
    @inject(STATE_EVOLUTION_PASS_ID) private readonly pass: StateEvolutionPass,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('StateEvolutionWorker');
  }

  requestRun(chatId: number): void {
    const state = this.chatStates.get(chatId);
    if (state?.running) {
      state.rerun = true;
      return;
    }
    void this.drain(chatId);
  }

  private async drain(chatId: number): Promise<void> {
    this.chatStates.set(chatId, { running: true, rerun: false });
    try {
      await this.pass.run(chatId);
    } catch (error) {
      this.logger.error(
        { error, chatId },
        'State evolution pass threw unexpectedly'
      );
    }
    const state = this.chatStates.get(chatId);
    if (state?.rerun) {
      state.rerun = false;
      void this.drain(chatId);
    } else {
      this.chatStates.delete(chatId);
    }
  }
}
