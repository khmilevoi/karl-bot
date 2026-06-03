import { inject, injectable } from 'inversify';
import type {
  VoiceMessageService,
  EnqueueVoiceMessageInput,
  EnqueueVoiceMessageResult,
} from '@/application/interfaces/voice/VoiceMessageService';
import {
  VOICE_CONFIG_ID,
  type VoiceConfig,
} from '@/application/voice/VoiceConfig';
import {
  VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID,
  type VoiceTranscriptionJobRepository,
} from '@/domain/repositories/VoiceTranscriptionJobRepository';

@injectable()
export class DefaultVoiceMessageService implements VoiceMessageService {
  constructor(
    @inject(VOICE_TRANSCRIPTION_JOB_REPOSITORY_ID)
    private readonly jobRepo: VoiceTranscriptionJobRepository,
    @inject(VOICE_CONFIG_ID)
    private readonly voiceConfig: VoiceConfig
  ) {}

  async enqueue(
    input: EnqueueVoiceMessageInput
  ): Promise<EnqueueVoiceMessageResult> {
    if (!input.telegramFileId) {
      return { kind: 'rejected', reason: 'missing_file_id' };
    }
    if (
      input.durationSeconds !== undefined &&
      input.durationSeconds > this.voiceConfig.maxDurationSeconds
    ) {
      return { kind: 'rejected', reason: 'duration_too_long' };
    }

    const job = await this.jobRepo.createPendingMessageAndJob(
      {
        chatId: input.chatId,
        chatTitle: input.chatTitle,
        role: 'user',
        content: '[voice:pending]',
        userId: input.user.id,
        username: input.user.username,
        firstName: input.user.firstName,
        lastName: input.user.lastName,
        messageId: input.telegramMessageId,
        replyText: input.context.replyText,
        replyUsername: input.context.replyUsername,
        quoteText: input.context.quoteText,
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: input.chatId,
        telegramMessageId: input.telegramMessageId,
        telegramFileId: input.telegramFileId,
        availableAt: new Date().toISOString(),
      }
    );

    return { kind: 'queued', jobId: job.id, messageId: job.messageId };
  }
}
