import { inject, injectable } from 'inversify';

import type { StateImpactRisk } from '@/domain/behavior/schemas/primitives';
import {
  BEHAVIOR_EVENT_REPOSITORY_ID,
  type BehaviorEventRepository,
} from '@/domain/repositories/BehaviorEventRepository';
import {
  STATE_EVOLUTION_CURSOR_REPOSITORY_ID,
  type StateEvolutionCursorRepository,
} from '@/domain/repositories/StateEvolutionCursorRepository';

import {
  STATE_EVOLUTION_CONFIG_ID,
  type StateEvolutionConfig,
} from './BehaviorConfig';
import type { StateEvolutionTrigger } from './StateEvolutionTrigger';
import {
  STATE_EVOLUTION_WORKER_ID,
  type StateEvolutionWorker,
} from './StateEvolutionWorker';

@injectable()
export class DefaultStateEvolutionTrigger implements StateEvolutionTrigger {
  constructor(
    @inject(STATE_EVOLUTION_CONFIG_ID)
    private readonly config: StateEvolutionConfig,
    @inject(STATE_EVOLUTION_CURSOR_REPOSITORY_ID)
    private readonly cursorRepo: StateEvolutionCursorRepository,
    @inject(BEHAVIOR_EVENT_REPOSITORY_ID)
    private readonly eventRepo: BehaviorEventRepository,
    @inject(STATE_EVOLUTION_WORKER_ID)
    private readonly worker: StateEvolutionWorker
  ) {}

  async maybeSchedule(
    chatId: number,
    latestRisk: StateImpactRisk
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const cursor = await this.cursorRepo.get(chatId);
    const lastEventId = cursor?.lastEventId ?? 0;
    const lastRunAt = cursor?.lastRunAt ?? null;

    const count = await this.eventRepo.countByChatIdAfter(chatId, lastEventId);

    const effectiveThreshold =
      latestRisk === 'high'
        ? this.config.highRiskEventThreshold
        : this.config.eventThreshold;

    if (count < effectiveThreshold) {
      return;
    }

    if (lastRunAt !== null) {
      const cooldownExpiry =
        new Date(lastRunAt).getTime() + this.config.cooldownMs;
      if (Date.now() < cooldownExpiry) {
        return;
      }
    }

    this.worker.requestRun(chatId);
  }
}
