import { describe, expect, it } from 'vitest';

import { BEHAVIOR_DECISION_VALIDATOR_ID } from '../src/application/behavior/BehaviorDecisionValidator';
import { BEHAVIOR_EXECUTOR_ID } from '../src/application/behavior/BehaviorExecutor';
import { BEHAVIOR_PIPELINE_ID } from '../src/application/behavior/BehaviorPipeline';
import { BEHAVIOR_RATE_LIMITER_ID } from '../src/application/behavior/BehaviorRateLimiter';
import { BEHAVIOR_SUMMARIZATION_QUEUE_ID } from '../src/application/behavior/BehaviorSummarizationQueue';
import { PATCH_POLICY_ID } from '../src/application/behavior/PatchPolicy';
import { STATE_PATCH_APPLICATOR_ID } from '../src/application/behavior/StatePatchApplicator';
import { container } from '../src/container';

describe('behavior DI', () => {
  it('resolves the behavior pipeline', () => {
    expect(container.get(BEHAVIOR_PIPELINE_ID)).toBeTruthy();
  });

  it('resolves behavior validator and policy with default config', () => {
    const validator = container.get(BEHAVIOR_DECISION_VALIDATOR_ID);
    const policy = container.get(PATCH_POLICY_ID);

    const validation = validator.validate({
      confidence: 0.8,
      actions: [
        {
          type: 'react',
          intent: 'acknowledgement',
          emoji: '💀',
          target: { scope: 'trigger', pick: 'latest', index: null },
        },
        {
          type: 'react',
          intent: 'acknowledgement',
          emoji: '🧪',
          target: { scope: 'context', pick: 'latest', index: null },
        },
      ],
      statePatches: [],
      safetyNotes: [],
    });

    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.decision.actions).toHaveLength(1);
      expect(validation.droppedActions).toHaveLength(1);
    }

    expect(
      policy.evaluate({
        type: 'truth.add',
        text: 'Carl likes structured logs',
        relatedTruthIds: [],
        contradictsTruthIds: [],
        evidence: {
          messageIds: [1],
          summary: 'User stated it directly',
          confidence: 0.8,
        },
      })
    ).toEqual({ outcome: 'accept', reason: 'patch accepted' });
  });

  it('resolves phase 3 behavior services', () => {
    expect(container.get(BEHAVIOR_RATE_LIMITER_ID)).toBeTruthy();
    expect(container.get(BEHAVIOR_SUMMARIZATION_QUEUE_ID)).toBeTruthy();
    expect(container.get(BEHAVIOR_EXECUTOR_ID)).toBeTruthy();
    expect(container.get(STATE_PATCH_APPLICATOR_ID)).toBeTruthy();
  });
});
