import type { Context } from 'grammy';
import type { ServiceIdentifier } from 'inversify';

import type { TriggerReason } from '@/domain/triggers/Trigger';

export interface ChatResponder {
  generate(
    ctx: Context,
    chatId: number,
    triggerReason?: TriggerReason
  ): Promise<string>;
}

export const CHAT_RESPONDER_ID = Symbol.for(
  'ChatResponder'
) as ServiceIdentifier<ChatResponder>;
