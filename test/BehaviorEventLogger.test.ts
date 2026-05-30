import { describe, expect, it, vi } from 'vitest';

import { DefaultBehaviorEventLogger } from '../src/application/behavior/DefaultBehaviorEventLogger';
import type { BehaviorEventRepository } from '../src/domain/repositories/BehaviorEventRepository';
import type {
  BehaviorActionResult,
  BehaviorAiDecisionResult,
  BehaviorDecisionContext,
  BehaviorPatchResult,
} from '../src/application/behavior/BehaviorTypes';

function makeContext(): BehaviorDecisionContext {
  return {
    chatId: 1,
    gate: {
      shouldDecide: true,
      confidence: 0.9,
      reason: 'conflict',
      triggerMessageIds: [1],
      contextMessageIds: [2],
      stateImpactRisk: 'medium',
    },
    summary: '',
    messages: [],
    triggerMessageIds: [1],
    contextMessageIds: [2],
    state: {
      personality: {} as any,
      political: {} as any,
      profiles: [],
      truths: [],
    },
  };
}

function makeResult(): BehaviorAiDecisionResult {
  return {
    decision: {
      confidence: 0.8,
      actions: [],
      statePatches: [],
      safetyNotes: [],
    },
    metadata: {
      modelSlot: 'behaviorDecision',
      selectedModel: 'gpt-5.4-mini' as any,
      escalated: false,
      escalationReason: null,
      latencyMs: 150,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    },
  };
}

describe('DefaultBehaviorEventLogger', () => {
  it('calls BehaviorEventRepository.insert with mapped fields', async () => {
    const repo: BehaviorEventRepository = {
      insert: vi.fn().mockResolvedValue(42),
      findById: vi.fn(),
      findByChatId: vi.fn(),
    } as unknown as BehaviorEventRepository;

    const logger = new DefaultBehaviorEventLogger(repo);
    const id = await logger.logDecision({
      context: makeContext(),
      result: makeResult(),
    });

    expect(id).toBe(42);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        schemaVersion: 'behavior.v1',
        gateReason: 'conflict',
        gateConfidence: 0.9,
        gateStateImpactRisk: 'medium',
        triggerMessageIdsJson: '[1]',
        contextMessageIdsJson: '[2]',
        modelSlot: 'behaviorDecision',
        escalated: false,
        escalationReason: null,
        actionsJson: '[]',
        actionResultsJson: '[]',
        statePatchesJson: '[]',
        patchResultsJson: '[]',
        confidence: 0.8,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        latencyMs: 150,
      })
    );
  });

  it('persists action and patch results when provided', async () => {
    const repo: BehaviorEventRepository = {
      insert: vi.fn().mockResolvedValue(43),
      findById: vi.fn(),
      findByChatId: vi.fn(),
    } as unknown as BehaviorEventRepository;

    const actionResults: BehaviorActionResult[] = [
      {
        actionType: 'react',
        outcome: 'sent',
        reason: null,
        targetMessageId: 2,
        telegramMessageId: 200,
      },
    ];
    const patchResults: BehaviorPatchResult[] = [
      {
        patchType: 'truth.add',
        outcome: 'applied',
        reason: null,
        stateRef: {
          kind: 'bot_truth',
          truthId: 10,
          chatId: 1,
        },
      },
    ];

    const logger = new DefaultBehaviorEventLogger(repo);
    await logger.logDecision({
      context: makeContext(),
      result: makeResult(),
      actionResults,
      patchResults,
    });

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actionResultsJson: JSON.stringify(actionResults),
        patchResultsJson: JSON.stringify(patchResults),
      })
    );
  });
});
