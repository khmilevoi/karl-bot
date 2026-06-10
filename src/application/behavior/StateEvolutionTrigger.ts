import type { ServiceIdentifier } from 'inversify';

import type { StateImpactRisk } from '@/domain/behavior/schemas/primitives';

export interface StateEvolutionTrigger {
  maybeSchedule(chatId: number, latestRisk: StateImpactRisk): Promise<void>;
}

export const STATE_EVOLUTION_TRIGGER_ID = Symbol.for(
  'StateEvolutionTrigger'
) as ServiceIdentifier<StateEvolutionTrigger>;
