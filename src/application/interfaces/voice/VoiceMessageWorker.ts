import type { ServiceIdentifier } from 'inversify';

export interface VoiceMessageWorker {
  start(): void;
  stop(): void;
  drainOnce(): Promise<void>;
}

export const VOICE_MESSAGE_WORKER_ID = Symbol.for(
  'VoiceMessageWorker'
) as ServiceIdentifier<VoiceMessageWorker>;
