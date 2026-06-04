import type { ServiceIdentifier } from 'inversify';
import type { MessageContext } from '@/application/interfaces/messages/MessageContextExtractor';

export interface VoiceTelegramUser {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
}

export interface EnqueueVoiceMessageInput {
  chatId: number;
  chatTitle?: string;
  telegramMessageId: number;
  telegramFileId: string;
  durationSeconds?: number;
  user: VoiceTelegramUser;
  context: MessageContext;
}

export type EnqueueVoiceMessageResult =
  | { kind: 'queued'; jobId: number; messageId: number }
  | {
      kind: 'rejected';
      reason: 'duration_too_long' | 'missing_file_id' | 'invalid_input';
    };

export interface VoiceMessageService {
  enqueue(input: EnqueueVoiceMessageInput): Promise<EnqueueVoiceMessageResult>;
}

export const VOICE_MESSAGE_SERVICE_ID = Symbol.for(
  'VoiceMessageService'
) as ServiceIdentifier<VoiceMessageService>;
