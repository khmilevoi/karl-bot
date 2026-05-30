import type { ServiceIdentifier } from 'inversify';

import type {
  BehaviorAiDecisionResult,
  BehaviorDecisionContext,
} from './BehaviorTypes';

export interface BehaviorEventLogger {
  logDecision(params: {
    context: BehaviorDecisionContext;
    result: BehaviorAiDecisionResult;
  }): Promise<number>;
}

export const BEHAVIOR_EVENT_LOGGER_ID = Symbol.for(
  'BehaviorEventLogger'
) as ServiceIdentifier<BehaviorEventLogger>;
