import type { ServiceIdentifier } from 'inversify';

export interface VoiceConfig {
  workerConcurrency: number;
  workerPollIntervalMs: number;
  workerLockMs: number;
  workerMaxAttempts: number;
  transcriptionModel: string;
  maxDurationSeconds: number;
  transcriptionWaitTimeoutMs: number;
  transcriptionResultPollIntervalMs: number;
}

export const VOICE_CONFIG_ID = Symbol.for(
  'VoiceConfig'
) as ServiceIdentifier<VoiceConfig>;
