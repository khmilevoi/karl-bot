import type { ServiceIdentifier } from 'inversify';

import type { BehaviorDecisionContext } from './BehaviorTypes';

export interface BehaviorContextAssemblerInput {
  chatId: number;
  triggerMessageIds: number[];
  contextMessageIds: number[];
  gate: BehaviorDecisionContext['gate'];
}

export interface BehaviorContextAssembler {
  assemble(
    input: BehaviorContextAssemblerInput
  ): Promise<BehaviorDecisionContext>;
}

export const BEHAVIOR_CONTEXT_ASSEMBLER_ID = Symbol.for(
  'BehaviorContextAssembler'
) as ServiceIdentifier<BehaviorContextAssembler>;
