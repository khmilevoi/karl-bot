import type { ServiceIdentifier } from 'inversify';

import type { BehaviorPatchResult } from './BehaviorTypes';

export type StateEvolutionRunResult =
  | { kind: 'skipped' }
  | { kind: 'error'; errorEventId: number }
  | {
      kind: 'evolved';
      behaviorEventId: number;
      patchResults: BehaviorPatchResult[];
    };

export interface StateEvolutionPass {
  run(chatId: number): Promise<StateEvolutionRunResult>;
}

export const STATE_EVOLUTION_PASS_ID = Symbol.for(
  'StateEvolutionPass'
) as ServiceIdentifier<StateEvolutionPass>;
