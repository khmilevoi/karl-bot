import type { ServiceIdentifier } from 'inversify';

import type { BehaviorAction } from '@/domain/behavior/schemas/actions';
import type { LiveStatePatch } from '@/domain/behavior/schemas/patches';

export type BehaviorRateLimitResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: string;
    };

export interface BehaviorRateLimiter {
  checkAction(params: {
    chatId: number;
    action: BehaviorAction;
    nowMs?: number;
  }): BehaviorRateLimitResult;

  checkPatch(params: {
    chatId: number;
    patch: LiveStatePatch;
    nowMs?: number;
  }): BehaviorRateLimitResult;
}

export const BEHAVIOR_RATE_LIMITER_ID = Symbol.for(
  'BehaviorRateLimiter'
) as ServiceIdentifier<BehaviorRateLimiter>;
