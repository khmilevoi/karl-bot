import type { ServiceIdentifier } from 'inversify';

import type {
  BehaviorAiDecisionResult,
  BehaviorDecisionContext,
  GateAiResult,
  StoredBehaviorMessage,
} from './BehaviorTypes';

export interface BehaviorAiService {
  evaluateGate(messages: StoredBehaviorMessage[]): Promise<GateAiResult>;
  decideBehavior(
    context: BehaviorDecisionContext
  ): Promise<BehaviorAiDecisionResult>;
}

export const BEHAVIOR_AI_SERVICE_ID = Symbol.for(
  'BehaviorAiService'
) as ServiceIdentifier<BehaviorAiService>;
