import type { ServiceIdentifier } from 'inversify';

import type { BehaviorAction } from '@/domain/behavior/schemas/actions';
import type { BehaviorDecision } from '@/domain/behavior/schemas/decision';

export interface DroppedAction {
  action: BehaviorAction;
  reason: string;
}

export interface ValidBehaviorDecision {
  ok: true;
  decision: BehaviorDecision;
  droppedActions: DroppedAction[];
}

export interface InvalidBehaviorDecision {
  ok: false;
  errorCode: 'behavior_decision_validation';
  issues: string[];
}

export type BehaviorDecisionValidationResult =
  | ValidBehaviorDecision
  | InvalidBehaviorDecision;

export interface BehaviorDecisionValidator {
  validate(raw: unknown): BehaviorDecisionValidationResult;
}

export const BEHAVIOR_DECISION_VALIDATOR_ID = Symbol.for(
  'BehaviorDecisionValidator'
) as ServiceIdentifier<BehaviorDecisionValidator>;

export interface BehaviorDecisionValidatorConfig {
  maxReplyLength: number;
  allowedEmoji: readonly string[];
}
