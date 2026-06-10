import type { ServiceIdentifier } from 'inversify';

export interface AudioTranscriptionInput {
  telegramFileId: string;
  durationSeconds?: number;
}

export interface QueuedAudioTranscriptionService {
  transcribe(input: AudioTranscriptionInput): Promise<string>;
}

export const QUEUED_AUDIO_TRANSCRIPTION_SERVICE_ID = Symbol.for(
  'QueuedAudioTranscriptionService'
) as ServiceIdentifier<QueuedAudioTranscriptionService>;
