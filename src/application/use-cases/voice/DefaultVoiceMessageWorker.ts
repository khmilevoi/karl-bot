import { inject, injectable } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  MESSAGE_SERVICE_ID,
  type MessageService,
} from '@/application/interfaces/messages/MessageService';
import {
  AUDIO_CONVERSION_SERVICE_ID,
  type AudioConversionService,
} from '@/application/interfaces/voice/AudioConversionService';
import {
  AUDIO_TRANSCRIPTION_SERVICE_ID,
  type AudioTranscriptionService,
} from '@/application/interfaces/voice/AudioTranscriptionService';
import {
  TELEGRAM_FILE_DOWNLOAD_SERVICE_ID,
  type TelegramFileDownloadService,
} from '@/application/interfaces/voice/TelegramFileDownloadService';
import type { VoiceMessageWorker } from '@/application/interfaces/voice/VoiceMessageWorker';
import {
  VOICE_CONFIG_ID,
  type VoiceConfig,
} from '@/application/voice/VoiceConfig';
import {
  BEHAVIOR_PIPELINE_ID,
  type BehaviorPipeline,
} from '@/application/behavior/BehaviorPipeline';
import {
  VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID,
  type VoiceTranscriptionJobRepository,
} from '@/domain/repositories/VoiceTranscriptionJobRepository';
import type { VoiceTranscriptionJob } from '@/domain/voice/VoiceTypes';

const BACKOFF_MS_BY_ATTEMPT = [30_000, 120_000, 600_000];

@injectable()
export class DefaultVoiceMessageWorker implements VoiceMessageWorker {
  private polling = false;
  private readonly logger: Logger;

  constructor(
    @inject(VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID)
    private readonly jobRepo: VoiceTranscriptionJobRepository,
    @inject(MESSAGE_SERVICE_ID)
    private readonly messageService: MessageService,
    @inject(BEHAVIOR_PIPELINE_ID)
    private readonly behaviorPipeline: BehaviorPipeline,
    @inject(TELEGRAM_FILE_DOWNLOAD_SERVICE_ID)
    private readonly fileDownload: TelegramFileDownloadService,
    @inject(AUDIO_CONVERSION_SERVICE_ID)
    private readonly audioConversion: AudioConversionService,
    @inject(AUDIO_TRANSCRIPTION_SERVICE_ID)
    private readonly transcription: AudioTranscriptionService,
    @inject(VOICE_CONFIG_ID)
    private readonly config: VoiceConfig,
    @inject(LOGGER_FACTORY_ID)
    loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('DefaultVoiceMessageWorker');
  }

  start(): void {
    if (this.polling) return;
    this.polling = true;
    void this.poll();
  }

  stop(): void {
    this.polling = false;
  }

  async drainOnce(): Promise<void> {
    const now = new Date().toISOString();
    const lockedUntil = new Date(
      Date.now() + this.config.workerLockMs
    ).toISOString();

    const claims = await Promise.all(
      Array.from({ length: this.config.workerConcurrency }, () =>
        this.jobRepo.claimNext(now, lockedUntil)
      )
    );

    const jobs = claims.filter(
      (job): job is VoiceTranscriptionJob => job !== null
    );

    await Promise.all(jobs.map((job) => this.processJob(job)));
  }

  private async processJob(job: VoiceTranscriptionJob): Promise<void> {
    try {
      const downloaded = await this.fileDownload.download(job.telegramFileId);
      const converted =
        await this.audioConversion.convertForTranscription(downloaded);
      const transcript = await this.transcription.transcribe(converted);

      if (!transcript.trim()) {
        throw new Error('Empty transcript returned');
      }

      const content = transcript.trim();
      const now = new Date().toISOString();

      const updatedMessage = await this.messageService.markVoiceTranscribed(
        job.messageId,
        content
      );

      if (updatedMessage === null) {
        await this.jobRepo.markCancelled(
          job.id,
          'message no longer active',
          now
        );
        return;
      }

      const { id, chatId } = updatedMessage;
      if (id === undefined) {
        throw new Error('Transcribed message is missing id');
      }

      await this.behaviorPipeline.handleStoredMessage({
        message: { ...updatedMessage, id, chatId },
        directTrigger: null,
      });

      await this.jobRepo.markDone(job.id, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();

      this.logger.error(
        { error: String(error), jobId: job.id },
        'Voice job processing failed'
      );

      if (job.attempts >= this.config.workerMaxAttempts) {
        await this.jobRepo.markFailed(job.id, message, now);
        await this.messageService.markVoiceFailed(job.messageId);
      } else {
        const backoffMs = BACKOFF_MS_BY_ATTEMPT[job.attempts - 1] ?? 600_000;
        const availableAt = new Date(Date.now() + backoffMs).toISOString();
        await this.jobRepo.requeue(job.id, availableAt, message, now);
      }
    }
  }

  private async poll(): Promise<void> {
    if (!this.polling) return;
    try {
      await this.drainOnce();
    } catch (e) {
      this.logger.error({ error: String(e) }, 'poll loop error');
    }
    if (this.polling) {
      setTimeout(() => {
        void this.poll();
      }, this.config.workerPollIntervalMs);
    }
  }
}
