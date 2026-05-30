import { inject, injectable } from 'inversify';

import type { BehaviorAction } from '@/domain/behavior/schemas/actions';
import type { LiveStatePatch } from '@/domain/behavior/schemas/patches';

import {
  BEHAVIOR_RATE_LIMITER_CONFIG_ID,
  type BehaviorRateLimiterConfig,
} from './BehaviorConfig';
import type {
  BehaviorRateLimiter,
  BehaviorRateLimitResult,
} from './BehaviorRateLimiter';

@injectable()
export class DefaultBehaviorRateLimiter implements BehaviorRateLimiter {
  private readonly initiativeHits = new Map<number, number[]>();
  private readonly reactionHits = new Map<number, number[]>();
  private readonly truthAddHits = new Map<number, number[]>();

  constructor(
    @inject(BEHAVIOR_RATE_LIMITER_CONFIG_ID)
    private readonly config: BehaviorRateLimiterConfig
  ) {}

  checkAction(params: {
    chatId: number;
    action: BehaviorAction;
    nowMs?: number;
  }): BehaviorRateLimitResult {
    const nowMs = params.nowMs ?? Date.now();

    switch (params.action.type) {
      case 'reply':
      case 'ask_question':
        return this.checkBucket({
          chatId: params.chatId,
          hitsByChat: this.initiativeHits,
          maxHits: this.config.maxInitiativesPerWindow,
          nowMs,
          reason: 'initiative rate limit exceeded',
          windowMs: this.config.initiativeWindowMs,
        });
      case 'react':
        return this.checkBucket({
          chatId: params.chatId,
          hitsByChat: this.reactionHits,
          maxHits: this.config.maxReactionsPerWindow,
          nowMs,
          reason: 'reaction rate limit exceeded',
          windowMs: this.config.reactionWindowMs,
        });
      case 'summarize_thread':
        return { allowed: true };
    }
  }

  checkPatch(params: {
    chatId: number;
    patch: LiveStatePatch;
    nowMs?: number;
  }): BehaviorRateLimitResult {
    if (params.patch.type !== 'truth.add') {
      return { allowed: true };
    }

    return this.checkBucket({
      chatId: params.chatId,
      hitsByChat: this.truthAddHits,
      maxHits: this.config.maxTruthAddsPerWindow,
      nowMs: params.nowMs ?? Date.now(),
      reason: 'truth-add rate limit exceeded',
      windowMs: this.config.truthAddWindowMs,
    });
  }

  private checkBucket(params: {
    chatId: number;
    hitsByChat: Map<number, number[]>;
    maxHits: number;
    nowMs: number;
    reason: string;
    windowMs: number;
  }): BehaviorRateLimitResult {
    const cutoff = params.nowMs - params.windowMs;
    const hits = (params.hitsByChat.get(params.chatId) ?? []).filter(
      (hit) => hit > cutoff
    );

    if (hits.length >= params.maxHits) {
      params.hitsByChat.set(params.chatId, hits);
      return { allowed: false, reason: params.reason };
    }

    hits.push(params.nowMs);
    params.hitsByChat.set(params.chatId, hits);
    return { allowed: true };
  }
}
