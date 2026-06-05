import { describe, expect, it } from 'vitest';

import { BEHAVIOR_AI_SERVICE_ID } from '../src/application/behavior/BehaviorAiService';
import { BEHAVIOR_DECISION_VALIDATOR_ID } from '../src/application/behavior/BehaviorDecisionValidator';
import { BEHAVIOR_EXECUTOR_ID } from '../src/application/behavior/BehaviorExecutor';
import { BEHAVIOR_PIPELINE_ID } from '../src/application/behavior/BehaviorPipeline';
import { BEHAVIOR_RATE_LIMITER_ID } from '../src/application/behavior/BehaviorRateLimiter';
import { BEHAVIOR_SUMMARIZATION_QUEUE_ID } from '../src/application/behavior/BehaviorSummarizationQueue';
import { PATCH_POLICY_ID } from '../src/application/behavior/PatchPolicy';
import { STATE_PATCH_APPLICATOR_ID } from '../src/application/behavior/StatePatchApplicator';
import { STATE_EVOLUTION_CONTEXT_ASSEMBLER_ID } from '../src/application/behavior/StateEvolutionContextAssembler';
import { STATE_EVOLUTION_PASS_ID } from '../src/application/behavior/StateEvolutionPass';
import { STATE_EVOLUTION_SCHEDULER_ID } from '../src/application/behavior/StateEvolutionScheduler';
import { STATE_EVOLUTION_TRIGGER_ID } from '../src/application/behavior/StateEvolutionTrigger';
import { STATE_EVOLUTION_WORKER_ID } from '../src/application/behavior/StateEvolutionWorker';
import { AI_SERVICE_ID } from '../src/application/interfaces/ai/AIService';
import { OPEN_AI_GATEWAY_ID } from '../src/application/interfaces/ai/OpenAiGateway';
import { PERSONALITY_SIGNAL_REPOSITORY_ID } from '../src/domain/repositories/PersonalitySignalRepository';
import { STATE_EVOLUTION_CURSOR_REPOSITORY_ID } from '../src/domain/repositories/StateEvolutionCursorRepository';
import { USER_POLITICAL_PROFILE_REPOSITORY_ID } from '../src/domain/repositories/UserPoliticalProfileRepository';
import { container } from '../src/container';

describe('behavior DI', () => {
  it('resolves the behavior pipeline', () => {
    expect(container.get(BEHAVIOR_PIPELINE_ID)).toBeTruthy();
  });

  it('resolves AI services and the OpenAI gateway', () => {
    expect(container.get(AI_SERVICE_ID)).toBeTruthy();
    expect(container.get(BEHAVIOR_AI_SERVICE_ID)).toBeTruthy();
    expect(container.get(OPEN_AI_GATEWAY_ID)).toBeTruthy();
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

  it('resolves phase 4 state evolution services and repositories', () => {
    expect(container.get(STATE_EVOLUTION_CONTEXT_ASSEMBLER_ID)).toBeTruthy();
    expect(container.get(STATE_EVOLUTION_PASS_ID)).toBeTruthy();
    expect(container.get(STATE_EVOLUTION_WORKER_ID)).toBeTruthy();
    expect(container.get(STATE_EVOLUTION_TRIGGER_ID)).toBeTruthy();
    expect(container.get(STATE_EVOLUTION_SCHEDULER_ID)).toBeTruthy();
    expect(container.get(PERSONALITY_SIGNAL_REPOSITORY_ID)).toBeTruthy();
    expect(container.get(STATE_EVOLUTION_CURSOR_REPOSITORY_ID)).toBeTruthy();
    expect(container.get(USER_POLITICAL_PROFILE_REPOSITORY_ID)).toBeTruthy();
  });
});
