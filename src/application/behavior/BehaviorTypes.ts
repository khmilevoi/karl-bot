import type { ChatModel } from 'openai/resources/shared';

import type { BehaviorPromptContext } from '@/application/prompts/PromptTypes';
import type { BehaviorDecision } from '@/domain/behavior/schemas/decision';
import type {
  BehaviorGateDecision,
  GateReason,
} from '@/domain/behavior/schemas/gate';
import type { ChatMessage } from '@/domain/messages/ChatMessage';

export interface StoredBehaviorMessage extends ChatMessage {
  id: number;
  chatId: number;
}

export interface DirectBehaviorTrigger {
  reason: Extract<GateReason, 'direct_trigger'>;
  why: string;
  triggerMessageId: number;
  replyToTelegramMessageId: number | null;
}

export interface BehaviorDecisionContext extends BehaviorPromptContext {
  chatId: number;
  gate: BehaviorGateDecision;
}

export interface AiCallUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface AiCallMetadata {
  modelSlot: string;
  selectedModel: ChatModel;
  escalated: boolean;
  escalationReason: string | null;
  latencyMs: number;
  usage: AiCallUsage;
}

export interface GateAiResult {
  decision: BehaviorGateDecision;
  metadata: AiCallMetadata;
}

export interface BehaviorAiDecisionResult {
  decision: BehaviorDecision;
  metadata: AiCallMetadata;
}
