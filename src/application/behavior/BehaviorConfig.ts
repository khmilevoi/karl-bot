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
