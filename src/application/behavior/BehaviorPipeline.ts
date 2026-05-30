import type { ServiceIdentifier } from 'inversify';

import type { BehaviorDecision } from '@/domain/behavior/schemas/decision';
import type { BehaviorGateDecision } from '@/domain/behavior/schemas/gate';

import type {
  BehaviorDecisionContext,
  DirectBehaviorTrigger,
  StoredBehaviorMessage,
} from './BehaviorTypes';

export type BehaviorPipelineResult =
  | { kind: 'queued' }
  | { kind: 'ignored'; gate: BehaviorGateDecision }
  | {
      kind: 'decided';
      context: BehaviorDecisionContext;
      decision: BehaviorDecision;
      behaviorEventId: number;
    }
  | { kind: 'error'; errorEventId: number };

export interface BehaviorPipelineInput {
  message: StoredBehaviorMessage;
  directTrigger?: DirectBehaviorTrigger | null;
}

export interface BehaviorPipeline {
  handleStoredMessage(
    input: BehaviorPipelineInput
  ): Promise<BehaviorPipelineResult>;
}

export const BEHAVIOR_PIPELINE_ID = Symbol.for(
  'BehaviorPipeline'
) as ServiceIdentifier<BehaviorPipeline>;
