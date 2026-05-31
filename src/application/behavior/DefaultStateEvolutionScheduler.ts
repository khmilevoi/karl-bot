import { inject, injectable } from 'inversify';
import cron, { type ScheduledTask } from 'node-cron';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  STATE_EVOLUTION_CURSOR_REPOSITORY_ID,
  type StateEvolutionCursorRepository,
} from '@/domain/repositories/StateEvolutionCursorRepository';

import {
  STATE_EVOLUTION_CONFIG_ID,
  type StateEvolutionConfig,
} from './BehaviorConfig';
import type { StateEvolutionScheduler } from './StateEvolutionScheduler';
import {
  STATE_EVOLUTION_WORKER_ID,
  type StateEvolutionWorker,
} from './StateEvolutionWorker';

@injectable()
export class DefaultStateEvolutionScheduler implements StateEvolutionScheduler {
  private task: ScheduledTask | null = null;
  private readonly logger: Logger;

  constructor(
    @inject(STATE_EVOLUTION_CONFIG_ID)
    private readonly config: StateEvolutionConfig,
    @inject(STATE_EVOLUTION_CURSOR_REPOSITORY_ID)
    private readonly cursorRepo: StateEvolutionCursorRepository,
    @inject(STATE_EVOLUTION_WORKER_ID)
    private readonly worker: StateEvolutionWorker,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('StateEvolutionScheduler');
  }

  start(): void {
    if (!this.config.enabled || this.task !== null) {
      return;
    }
    this.task = cron.schedule(this.config.sweepCron, () => void this.sweep());
    this.logger.debug(
      { sweepCron: this.config.sweepCron },
      'State evolution sweep scheduler started'
    );
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async sweep(): Promise<void> {
    const notRunSince = new Date(
      Date.now() - this.config.maxIntervalMs
    ).toISOString();
    try {
      const chatIds = await this.cursorRepo.findChatsNeedingSweep(notRunSince);
      for (const chatId of chatIds) {
        this.worker.requestRun(chatId);
      }
      if (chatIds.length > 0) {
        this.logger.debug(
          { count: chatIds.length },
          'State evolution sweep scheduled runs'
        );
      }
    } catch (error) {
      this.logger.error({ error }, 'State evolution sweep failed');
    }
  }
}
