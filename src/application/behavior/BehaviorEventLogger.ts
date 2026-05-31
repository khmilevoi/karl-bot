import type { ServiceIdentifier } from 'inversify';

import type { StateImpactRisk } from '@/domain/behavior/schemas/primitives';

import type {
  BehaviorActionResult,
  BehaviorAiDecisionResult,
  BehaviorDecisionContext,
  BehaviorPatchResult,
  StateEvolutionResult,
} from './BehaviorTypes';

export interface BehaviorEventLogger {
  logDecision(params: {
    context: BehaviorDecisionContext;
    result: BehaviorAiDecisionResult;
    actionResults?: BehaviorActionResult[];
    patchResults?: BehaviorPatchResult[];
  }): Promise<number>;
  logEvolution(params: {
    chatId: number;
    result: StateEvolutionResult;
    patchResults: BehaviorPatchResult[];
    maxStateImpactRisk: StateImpactRisk;
  }): Promise<number>;
}

export const BEHAVIOR_EVENT_LOGGER_ID = Symbol.for(
  'BehaviorEventLogger'
) as ServiceIdentifier<BehaviorEventLogger>;
