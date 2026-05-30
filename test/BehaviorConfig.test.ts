import { describe, expect, it } from 'vitest';

import { DEFAULT_BEHAVIOR_PIPELINE_CONFIG } from '../src/application/behavior/BehaviorConfig';

describe('DEFAULT_BEHAVIOR_PIPELINE_CONFIG', () => {
  it('keeps batching thresholds explicit and coherent', () => {
    expect(DEFAULT_BEHAVIOR_PIPELINE_CONFIG.batchSizeCap).toBeGreaterThan(0);
    expect(DEFAULT_BEHAVIOR_PIPELINE_CONFIG.batchHardCapMs).toBeGreaterThan(
      DEFAULT_BEHAVIOR_PIPELINE_CONFIG.batchIdleGapMs
    );
    expect(
      DEFAULT_BEHAVIOR_PIPELINE_CONFIG.maxDirectContextMessages
    ).toBeLessThanOrEqual(DEFAULT_BEHAVIOR_PIPELINE_CONFIG.batchSizeCap);
  });
});
