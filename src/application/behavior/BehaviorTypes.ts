import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import type { BehaviorPromptContext } from '@/application/prompts/PromptTypes';
import type { StateImpactRisk } from '@/domain/behavior/schemas/primitives';
import type { PersonalitySignal } from '@/domain/behavior/schemas/state';
import type { BehaviorAction } from '@/domain/behavior/schemas/actions';
import type { BehaviorDecision } from '@/domain/behavior/schemas/decision';
import type {
  BehaviorGateDecision,
  GateReason,
} from '@/domain/behavior/schemas/gate';
import type {
  EvolutionPatch,
  LiveStatePatch,
} from '@/domain/behavior/schemas/patches';
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
  selectedModel: AiModelId;
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

export type BehaviorActionOutcome =
  | 'sent'
  | 'queued'
  | 'bumped'
  | 'deferred'
  | 'dropped'
  | 'rate_limited'
  | 'failed'
  | 'skipped';

export interface BehaviorActionResult {
  actionType: BehaviorAction['type'];
  outcome: BehaviorActionOutcome;
  reason: string | null;
  targetMessageId?: number | null;
  telegramMessageId?: number | null;
}

export type BehaviorPatchOutcome =
  | 'applied'
  | 'merged'
  | 'rejected'
  | 'rate_limited'
  | 'failed'
  | 'escalated'
  | 'to_uncertainty';

export type BehaviorPatchStateRef =
  | {
      kind: 'user_social_profile';
      chatId: number;
      userId: number;
    }
  | {
      kind: 'bot_truth';
      chatId: number;
      truthId: number;
    }
  | {
      kind: 'bot_personality_signal';
      chatId: number;
    }
  | {
      kind: 'bot_political_state';
      chatId: number;
    }
  | {
      kind: 'user_political_profile';
      chatId: number;
      userId: number;
    };

export interface BehaviorPatchResult {
  patchType: LiveStatePatch['type'] | EvolutionPatch['type'];
  outcome: BehaviorPatchOutcome;
  reason: string | null;
  stateRef?: BehaviorPatchStateRef | null;
}

export interface StateEvolutionContext extends BehaviorPromptContext {
  chatId: number;
  maxStateImpactRisk: StateImpactRisk;
  personalitySignals: PersonalitySignal[];
}

export interface StateEvolutionResult {
  decision: import('@/domain/behavior/schemas/evolution').StateEvolutionDecision; // eslint-disable-line @typescript-eslint/consistent-type-imports
  metadata: AiCallMetadata;
}
