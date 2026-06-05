import type { ServiceIdentifier } from 'inversify';

import type { BehaviorDecisionValidatorConfig } from './BehaviorDecisionValidator';
import type { PatchPolicyConfig } from './PatchPolicy';

export interface BehaviorPipelineConfig {
  batchSizeCap: number;
  batchHardCapMs: number;
  batchIdleGapMs: number;
  maxDirectContextMessages: number;
  recentHistoryLimit: number;
  minDecisionConfidence: number;
}

export const DEFAULT_BEHAVIOR_PIPELINE_CONFIG: BehaviorPipelineConfig = {
  batchSizeCap: 12,
  batchHardCapMs: 45_000,
  batchIdleGapMs: 8_000,
  maxDirectContextMessages: 12,
  recentHistoryLimit: 80,
  minDecisionConfidence: 0.45,
};

export const BEHAVIOR_PIPELINE_CONFIG_ID = Symbol.for(
  'BehaviorPipelineConfig'
) as ServiceIdentifier<BehaviorPipelineConfig>;

export const DEFAULT_BEHAVIOR_DECISION_VALIDATOR_CONFIG: BehaviorDecisionValidatorConfig =
  {
    maxReplyLength: 2_000,
    allowedEmoji: [
      '👍',
      '👎',
      '❤️',
      '😂',
      '😮',
      '😢',
      '😡',
      '👏',
      '🤔',
      '🤝',
      '💀',
      '🤡',
      '😭',
      '🔥',
      '👀',
      '🙏',
      '✨',
      '🥹',
      '🫶',
      '🫠',
    ],
  };

export const BEHAVIOR_DECISION_VALIDATOR_CONFIG_ID = Symbol.for(
  'BehaviorDecisionValidatorConfig'
) as ServiceIdentifier<BehaviorDecisionValidatorConfig>;

export const DEFAULT_PATCH_POLICY_CONFIG: PatchPolicyConfig = {
  personalityMinConfidence: 0.5,
  politicalWeakMaxConfidence: 0.4,
  politicalStrongMinConfidence: 0.7,
  hardBoundaryTerms: [
    'credible threat',
    'real-world violence',
    'dehumanization',
    'targeted harassment',
  ],
};

export const PATCH_POLICY_CONFIG_ID = Symbol.for(
  'PatchPolicyConfig'
) as ServiceIdentifier<PatchPolicyConfig>;

export interface BehaviorRateLimiterConfig {
  initiativeWindowMs: number;
  maxInitiativesPerWindow: number;
  reactionWindowMs: number;
  maxReactionsPerWindow: number;
  truthAddWindowMs: number;
  maxTruthAddsPerWindow: number;
}

export const DEFAULT_BEHAVIOR_RATE_LIMITER_CONFIG: BehaviorRateLimiterConfig = {
  initiativeWindowMs: 60_000,
  maxInitiativesPerWindow: 3,
  reactionWindowMs: 60_000,
  maxReactionsPerWindow: 20,
  truthAddWindowMs: 10 * 60_000,
  // The bot invents and persists biographical self-facts when asked about its
  // past; a single biography Q&A can emit well over a dozen truth.add patches
  // in one window. Keep a ceiling against runaway state churn, but high enough
  // not to silently drop a normal biography burst (old value of 3 did).
  maxTruthAddsPerWindow: 12,
};

export const BEHAVIOR_RATE_LIMITER_CONFIG_ID = Symbol.for(
  'BehaviorRateLimiterConfig'
) as ServiceIdentifier<BehaviorRateLimiterConfig>;

export interface BehaviorSummarizationQueueConfig {
  enabled: boolean;
}

export const DEFAULT_BEHAVIOR_SUMMARIZATION_QUEUE_CONFIG: BehaviorSummarizationQueueConfig =
  {
    enabled: false,
  };

export const BEHAVIOR_SUMMARIZATION_QUEUE_CONFIG_ID = Symbol.for(
  'BehaviorSummarizationQueueConfig'
) as ServiceIdentifier<BehaviorSummarizationQueueConfig>;

export interface StateEvolutionConfig {
  enabled: boolean;
  eventThreshold: number;
  highRiskEventThreshold: number;
  cooldownMs: number;
  maxIntervalMs: number;
  recentMessageLimit: number;
  sweepCron: string;
}

export const DEFAULT_STATE_EVOLUTION_CONFIG: StateEvolutionConfig = {
  enabled: true,
  eventThreshold: 8,
  highRiskEventThreshold: 3,
  cooldownMs: 5 * 60_000,
  maxIntervalMs: 60 * 60_000,
  recentMessageLimit: 60,
  sweepCron: '0 */3 * * *',
};

export const STATE_EVOLUTION_CONFIG_ID = Symbol.for(
  'StateEvolutionConfig'
) as ServiceIdentifier<StateEvolutionConfig>;
