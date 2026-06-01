import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
  DEFAULT_BEHAVIOR_RATE_LIMITER_CONFIG,
} from '../src/application/behavior/BehaviorConfig';

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

describe('DEFAULT_BEHAVIOR_RATE_LIMITER_CONFIG', () => {
  it('allows a biography interrogation burst of truth.add within one window', () => {
    // Carl's persona invents and persists self-facts when asked about his past.
    // A single biography Q&A (origin, a story, parents, parents' jobs, ...) can
    // emit well over the old cap of 3 truth.add patches inside one window; the
    // cap must be high enough not to silently drop that burst.
    expect(
      DEFAULT_BEHAVIOR_RATE_LIMITER_CONFIG.maxTruthAddsPerWindow
    ).toBeGreaterThanOrEqual(12);
  });
});
