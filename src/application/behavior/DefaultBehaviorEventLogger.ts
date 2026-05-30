import { inject, injectable } from 'inversify';

import {
  BEHAVIOR_EVENT_REPOSITORY_ID,
  type BehaviorEventRepository,
} from '@/domain/repositories/BehaviorEventRepository';

import type { BehaviorEventLogger } from './BehaviorEventLogger';
import type {
  BehaviorAiDecisionResult,
  BehaviorDecisionContext,
} from './BehaviorTypes';

@injectable()
export class DefaultBehaviorEventLogger implements BehaviorEventLogger {
  constructor(
    @inject(BEHAVIOR_EVENT_REPOSITORY_ID)
    private readonly repo: BehaviorEventRepository
  ) {}

  async logDecision(params: {
    context: BehaviorDecisionContext;
    result: BehaviorAiDecisionResult;
  }): Promise<number> {
    const { context, result } = params;
    const { gate } = context;
    const { decision, metadata } = result;
    const now = new Date().toISOString();

    return this.repo.insert({
      chatId: context.chatId,
      schemaVersion: 'behavior.v1',
      gateReason: gate.reason,
      gateConfidence: gate.confidence,
      gateStateImpactRisk: gate.stateImpactRisk,
      triggerMessageIdsJson: JSON.stringify(context.triggerMessageIds),
      contextMessageIdsJson: JSON.stringify(context.contextMessageIds),
      modelSlot: metadata.modelSlot,
      selectedModel: metadata.selectedModel,
      escalated: metadata.escalated,
      escalationReason: metadata.escalationReason,
      actionsJson: JSON.stringify(decision.actions),
      actionResultsJson: JSON.stringify([]),
      statePatchesJson: JSON.stringify(decision.statePatches),
      patchResultsJson: JSON.stringify([]),
      confidence: decision.confidence,
      promptTokens: metadata.usage.promptTokens,
      completionTokens: metadata.usage.completionTokens,
      totalTokens: metadata.usage.totalTokens,
      latencyMs: metadata.latencyMs,
      createdAt: now,
    });
  }
}
