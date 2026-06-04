export type AudioTranscriptionJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface AudioTranscriptionJob {
  id: number;
  telegramFileId: string;
  status: AudioTranscriptionJobStatus;
  attempts: number;
  availableAt: string;
  lockedUntil: string | null;
  resultText: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewAudioTranscriptionJob {
  telegramFileId: string;
  availableAt: string;
}
