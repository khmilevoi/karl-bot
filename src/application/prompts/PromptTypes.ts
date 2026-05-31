import type {
  BotPersonalityState,
  BotPoliticalState,
  BotTruth,
  UserSocialProfile,
} from '@/domain/behavior/schemas/state';
import type { ChatMessage } from '@/domain/messages/ChatMessage';

export interface PromptChatUser {
  username: string;
  fullName: string;
  attitude: string;
}

export interface BehaviorPromptMessage extends ChatMessage {
  id: number;
  chatId: number;
}

export interface BehaviorPromptState {
  personality: BotPersonalityState;
  political: BotPoliticalState;
  profiles: UserSocialProfile[];
  truths: BotTruth[];
}

export interface BehaviorMessageMarkers {
  triggerMessageIds: readonly number[];
  contextMessageIds: readonly number[];
  batchMessageIds: readonly number[];
}

export interface BehaviorPromptContext {
  summary: string;
  messages: BehaviorPromptMessage[];
  triggerMessageIds: number[];
  contextMessageIds: number[];
  batchMessageIds: number[];
  state: BehaviorPromptState;
}
