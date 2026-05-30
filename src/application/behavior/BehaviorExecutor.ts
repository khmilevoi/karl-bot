import type { ServiceIdentifier } from 'inversify';

import type { BehaviorAction } from '@/domain/behavior/schemas/actions';

import type { BehaviorActionResult, BehaviorDecisionContext } from './BehaviorTypes';

export interface BehaviorExecutor {
  execute(params: {
    context: BehaviorDecisionContext;
    actions: readonly BehaviorAction[];
    nowMs?: number;
  }): Promise<BehaviorActionResult[]>;
}

export const BEHAVIOR_EXECUTOR_ID = Symbol.for(
  'BehaviorExecutor'
) as ServiceIdentifier<BehaviorExecutor>;
