import type { ServiceIdentifier } from 'inversify';

export interface AudioTranscriptionWorker {
  start(): void;
  stop(): void;
  drainOnce(): Promise<void>;
}

export const AUDIO_TRANSCRIPTION_WORKER_ID = Symbol.for(
  'AudioTranscriptionWorker'
) as ServiceIdentifier<AudioTranscriptionWorker>;
