export type MessageSourceType = 'text' | 'voice';
export type MessageProcessingStatus = 'ready' | 'pending' | 'failed';

export type VoiceTranscriptionJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface VoiceTranscriptionJob {
  id: number;
  messageId: number;
  chatId: number;
  telegramMessageId: number;
  telegramFileId: string;
  status: VoiceTranscriptionJobStatus;
  attempts: number;
  availableAt: string;
  lockedUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewVoiceTranscriptionJob {
  chatId: number;
  telegramMessageId: number;
  telegramFileId: string;
  availableAt: string;
}
