import type { ServiceIdentifier } from 'inversify';

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
