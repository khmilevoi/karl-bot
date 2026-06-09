import type { ServiceIdentifier } from 'inversify';

export interface StateEvolutionScheduler {
  sweep(): Promise<void>;
}

export const STATE_EVOLUTION_SCHEDULER_ID = Symbol.for(
  'StateEvolutionScheduler'
) as ServiceIdentifier<StateEvolutionScheduler>;
