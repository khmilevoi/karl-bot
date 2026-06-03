import type { ServiceIdentifier } from 'inversify';
import type { StoredMessage } from '@/domain/messages/StoredMessage';
import type {
  NewVoiceTranscriptionJob,
  VoiceTranscriptionJob,
} from '@/domain/voice/VoiceTypes';

export interface VoiceTranscriptionJobRepository {
  createPendingMessageAndJob(
    message: StoredMessage,
    job: NewVoiceTranscriptionJob
  ): Promise<VoiceTranscriptionJob>;
  claimNext(
    now: string,
    lockedUntil: string
  ): Promise<VoiceTranscriptionJob | null>;
  markDone(jobId: number, now: string): Promise<void>;
  requeue(
    jobId: number,
    availableAt: string,
    lastError: string | null,
    now: string
  ): Promise<void>;
  markFailed(jobId: number, lastError: string, now: string): Promise<void>;
  markCancelled(jobId: number, reason: string, now: string): Promise<void>;
}

export const VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID = Symbol.for(
  'VoiceTranscriptionJobRepository'
) as ServiceIdentifier<VoiceTranscriptionJobRepository>;
