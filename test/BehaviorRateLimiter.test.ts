import { describe, expect, it } from 'vitest';

import { DefaultBehaviorRateLimiter } from '../src/application/behavior/DefaultBehaviorRateLimiter';
import type { BehaviorRateLimiterConfig } from '../src/application/behavior/BehaviorConfig';
import type { BehaviorAction } from '../src/domain/behavior/schemas/actions';
import type { LiveStatePatch } from '../src/domain/behavior/schemas/patches';

const config: BehaviorRateLimiterConfig = {
  initiativeWindowMs: 1_000,
  maxInitiativesPerWindow: 2,
  reactionWindowMs: 1_000,
  maxReactionsPerWindow: 1,
  truthAddWindowMs: 1_000,
  maxTruthAddsPerWindow: 1,
};

const replyAction: BehaviorAction = {
  type: 'reply',
  intent: 'banter',
  text: 'ok',
  target: { kind: 'none' },
};

const reactAction: BehaviorAction = {
  type: 'react',
  intent: 'acknowledgement',
  emoji: '👍',
  target: { scope: 'trigger', pick: 'latest', index: null },
};

const summarizeAction: BehaviorAction = {
  type: 'summarize_thread',
  intent: 'compress_context',
  reason: 'long thread',
};

const truthAddPatch: LiveStatePatch = {
  type: 'truth.add',
  text: 'Bot likes bounded writes',
  relatedTruthIds: [],
  contradictsTruthIds: [],
  evidence: {
    messageIds: [1],
    summary: 'stated directly',
    confidence: 0.8,
  },
};

describe('DefaultBehaviorRateLimiter', () => {
  it('limits initiative actions per chat within a sliding window', () => {
    const limiter = new DefaultBehaviorRateLimiter(config);

    expect(
      limiter.checkAction({ chatId: 1, action: replyAction, nowMs: 1_000 })
    ).toEqual({ allowed: true });
    expect(
      limiter.checkAction({ chatId: 1, action: replyAction, nowMs: 1_500 })
    ).toEqual({ allowed: true });
    expect(
      limiter.checkAction({ chatId: 1, action: replyAction, nowMs: 1_900 })
    ).toEqual({
      allowed: false,
      reason: 'initiative rate limit exceeded',
    });
    expect(
      limiter.checkAction({ chatId: 1, action: replyAction, nowMs: 2_001 })
    ).toEqual({ allowed: true });
  });

  it('limits reactions independently from initiative actions', () => {
    const limiter = new DefaultBehaviorRateLimiter(config);

    expect(
      limiter.checkAction({ chatId: 1, action: replyAction, nowMs: 1_000 })
    ).toEqual({ allowed: true });
    expect(
      limiter.checkAction({ chatId: 1, action: reactAction, nowMs: 1_100 })
    ).toEqual({ allowed: true });
    expect(
      limiter.checkAction({ chatId: 1, action: reactAction, nowMs: 1_200 })
    ).toEqual({
      allowed: false,
      reason: 'reaction rate limit exceeded',
    });
    expect(
      limiter.checkAction({ chatId: 2, action: reactAction, nowMs: 1_200 })
    ).toEqual({ allowed: true });
  });

  it('does not rate-limit summarize_thread actions', () => {
    const limiter = new DefaultBehaviorRateLimiter(config);

    expect(
      limiter.checkAction({ chatId: 1, action: summarizeAction, nowMs: 1_000 })
    ).toEqual({ allowed: true });
    expect(
      limiter.checkAction({ chatId: 1, action: summarizeAction, nowMs: 1_000 })
    ).toEqual({ allowed: true });
  });

  it('limits truth-add patches independently from other patch types', () => {
    const limiter = new DefaultBehaviorRateLimiter(config);

    expect(
      limiter.checkPatch({ chatId: 1, patch: truthAddPatch, nowMs: 1_000 })
    ).toEqual({ allowed: true });
    expect(
      limiter.checkPatch({ chatId: 1, patch: truthAddPatch, nowMs: 1_500 })
    ).toEqual({
      allowed: false,
      reason: 'truth-add rate limit exceeded',
    });
    expect(
      limiter.checkPatch({
        chatId: 1,
        patch: {
          type: 'truth.reinforce',
          truthId: 1,
          evidence: truthAddPatch.evidence,
        },
        nowMs: 1_500,
      })
    ).toEqual({ allowed: true });
  });
});
