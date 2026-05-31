import type { ServiceIdentifier } from 'inversify';

import type {
  BehaviorActionResult,
  BehaviorAiDecisionResult,
  BehaviorDecisionContext,
  BehaviorPatchResult,
} from './BehaviorTypes';

export interface BehaviorEventLogger {
  logDecision(params: {
    context: BehaviorDecisionContext;
    result: BehaviorAiDecisionResult;
    actionResults?: BehaviorActionResult[];
    patchResults?: BehaviorPatchResult[];
  }): Promise<number>;
}

export const BEHAVIOR_EVENT_LOGGER_ID = Symbol.for(
  'BehaviorEventLogger'
) as ServiceIdentifier<BehaviorEventLogger>;
