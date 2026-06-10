import type { ServiceIdentifier } from 'inversify';

import type { BehaviorEventEntity } from '@/domain/entities/BehaviorEventEntity';

import type { StateEvolutionContext } from './BehaviorTypes';

export interface StateEvolutionContextAssembler {
  assemble(params: {
    chatId: number;
    events: readonly BehaviorEventEntity[];
  }): Promise<StateEvolutionContext>;
}

export const STATE_EVOLUTION_CONTEXT_ASSEMBLER_ID = Symbol.for(
  'StateEvolutionContextAssembler'
) as ServiceIdentifier<StateEvolutionContextAssembler>;
