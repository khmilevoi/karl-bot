import { inject, injectable } from 'inversify';

import {
  AUDIO_TRANSCRIPTION_JOB_REPOSITORY_ID,
  type AudioTranscriptionJobRepository,
} from '@/domain/repositories/AudioTranscriptionJobRepository';
import type {
  AudioTranscriptionInput,
  QueuedAudioTranscriptionService,
} from '@/application/interfaces/voice/QueuedAudioTranscriptionService';
import {
  VOICE_CONFIG_ID,
  type VoiceConfig,
} from '@/application/voice/VoiceConfig';

@injectable()
export class DefaultQueuedAudioTranscriptionService implements QueuedAudioTranscriptionService {
  constructor(
    @inject(AUDIO_TRANSCRIPTION_JOB_REPOSITORY_ID)
    private readonly repo: AudioTranscriptionJobRepository,
    @inject(VOICE_CONFIG_ID)
    private readonly config: VoiceConfig
  ) {}

  async transcribe(input: AudioTranscriptionInput): Promise<string> {
    if (!input.telegramFileId) {
      throw new Error('telegramFileId must not be empty');
    }

    if (
      input.durationSeconds !== undefined &&
      input.durationSeconds > this.config.maxDurationSeconds
    ) {
      throw new Error(
        `Voice message duration ${input.durationSeconds}s exceeds maximum allowed ${this.config.maxDurationSeconds}s`
      );
    }

    const now = new Date().toISOString();
    const job = await this.repo.create({
      telegramFileId: input.telegramFileId,
      availableAt: now,
    });

    return new Promise<string>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        clearInterval(pollHandle);
        reject(
          new Error(
            `Transcription timeout: job ${job.id} did not complete in time`
          )
        );
      }, this.config.transcriptionWaitTimeoutMs);

      const pollHandle = setInterval(() => {
        void this.repo
          .findById(job.id)
          .then((found) => {
            if (!found) {
              clearInterval(pollHandle);
              clearTimeout(timeoutHandle);
              reject(new Error(`Transcription job ${job.id} not found`));
              return;
            }

            if (found.status === 'done') {
              clearInterval(pollHandle);
              clearTimeout(timeoutHandle);
              if (!found.resultText) {
                reject(
                  new Error(`Transcription job ${job.id} has empty result`)
                );
                return;
              }
              resolve(found.resultText.trim());
              return;
            }

            if (found.status === 'failed') {
              clearInterval(pollHandle);
              clearTimeout(timeoutHandle);
              reject(
                new Error(
                  `Transcription job ${job.id} failed: ${found.lastError ?? 'unknown error'}`
                )
              );
              return;
            }

            if (found.status === 'cancelled') {
              clearInterval(pollHandle);
              clearTimeout(timeoutHandle);
              reject(
                new Error(
                  `Transcription job ${job.id} was cancelled: ${found.lastError ?? 'unknown reason'}`
                )
              );
            }
          })
          .catch((err: unknown) => {
            clearInterval(pollHandle);
            clearTimeout(timeoutHandle);
            reject(err);
          });
      }, this.config.transcriptionResultPollIntervalMs);
    });
  }
}
