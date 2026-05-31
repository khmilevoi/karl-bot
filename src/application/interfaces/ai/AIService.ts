import type { ServiceIdentifier } from 'inversify';

import type { PromptChatUser } from '@/application/prompts/PromptTypes';
import type { ChatMessage } from '@/domain/messages/ChatMessage';

export interface AIService {
  summarize(history: ChatMessage[], prev?: string): Promise<string>;
  generateTopicOfDay(params?: {
    chatTitle?: string;
    summary?: string;
    users?: PromptChatUser[];
  }): Promise<string>;
}

export const AI_SERVICE_ID = Symbol.for(
  'AIService'
) as ServiceIdentifier<AIService>;
