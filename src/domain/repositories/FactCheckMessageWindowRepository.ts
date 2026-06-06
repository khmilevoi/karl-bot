import type { ServiceIdentifier } from 'inversify';

import type { ChatMessage } from '@/domain/messages/ChatMessage';

// Read port for fact-checking only. Distinct from FactCheckWindowRepository,
// which stores the per-chat watermark cursor.
export interface FactCheckMessageWindowRepository {
  findReadyByChatIdAfterId(
    chatId: number,
    afterId: number,
    limit: number
  ): Promise<ChatMessage[]>;
  findReadyContextBeforeId(
    chatId: number,
    beforeId: number,
    limit: number
  ): Promise<ChatMessage[]>;
}

export const FACT_CHECK_MESSAGE_WINDOW_REPOSITORY_ID = Symbol.for(
  'FactCheckMessageWindowRepository'
) as ServiceIdentifier<FactCheckMessageWindowRepository>;
