import type { ServiceIdentifier } from 'inversify';
import type {
  AudioTranscriptionJob,
  NewAudioTranscriptionJob,
} from '@/domain/voice/AudioTranscriptionJobTypes';

export interface AudioTranscriptionJobRepository {
  create(job: NewAudioTranscriptionJob): Promise<AudioTranscriptionJob>;
  findById(jobId: number): Promise<AudioTranscriptionJob | null>;
  claimNext(
    now: string,
    lockedUntil: string
  ): Promise<AudioTranscriptionJob | null>;
  markDone(jobId: number, resultText: string, now: string): Promise<void>;
  requeue(
    jobId: number,
    availableAt: string,
    lastError: string,
    now: string
  ): Promise<void>;
  markFailed(jobId: number, lastError: string, now: string): Promise<void>;
  markCancelled(jobId: number, reason: string, now: string): Promise<void>;
}

export const AUDIO_TRANSCRIPTION_JOB_REPOSITORY_ID = Symbol.for(
  'AudioTranscriptionJobRepository'
) as ServiceIdentifier<AudioTranscriptionJobRepository>;
