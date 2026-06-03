import { describe, expect, it, vi } from 'vitest';
import type { VoiceTranscriptionJobRepository } from '../src/domain/repositories/VoiceTranscriptionJobRepository';
import type { VoiceTranscriptionJob } from '../src/domain/voice/VoiceTypes';
import type { VoiceConfig } from '../src/application/voice/VoiceConfig';
import type { MessageContext } from '../src/application/interfaces/messages/MessageContextExtractor';
import { DefaultVoiceMessageService } from '../src/application/use-cases/voice/DefaultVoiceMessageService';

const now = '2026-06-03T00:00:00.000Z';

const defaultJob: VoiceTranscriptionJob = {
  id: 1,
  messageId: 10,
  chatId: 1,
  telegramMessageId: 99,
  telegramFileId: 'file-id',
  status: 'queued',
  attempts: 0,
  availableAt: now,
  lockedUntil: null,
  lastError: null,
  createdAt: now,
  updatedAt: now,
};

const defaultConfig: VoiceConfig = {
  workerConcurrency: 1,
  workerPollIntervalMs: 1000,
  workerLockMs: 300000,
  workerMaxAttempts: 3,
  transcriptionModel: 'gpt-4o-mini-transcribe',
  maxDurationSeconds: 120,
};

const defaultContext: MessageContext = {
  username: 'alice',
  fullName: 'Alice Smith',
};

function makeService(
  overrides: {
    repo?: Partial<VoiceTranscriptionJobRepository>;
    config?: Partial<VoiceConfig>;
  } = {}
) {
  const repo = {
    createPendingMessageAndJob: vi.fn().mockResolvedValue(defaultJob),
    claimNext: vi.fn(),
    markDone: vi.fn(),
    requeue: vi.fn(),
    markFailed: vi.fn(),
    markCancelled: vi.fn(),
    ...overrides.repo,
  } as unknown as VoiceTranscriptionJobRepository;
  const config = { ...defaultConfig, ...overrides.config };
  return { service: new DefaultVoiceMessageService(repo, config), repo };
}

describe('DefaultVoiceMessageService', () => {
  it('enqueues a pending voice message and job', async () => {
    const { service, repo } = makeService();

    const result = await service.enqueue({
      chatId: 1,
      chatTitle: 'Chat',
      telegramMessageId: 99,
      telegramFileId: 'file-id',
      durationSeconds: 12,
      user: {
        id: 10,
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Smith',
        fullName: 'Alice Smith',
      },
      context: defaultContext,
    });

    expect(result.kind).toBe('queued');
    if (result.kind === 'queued') {
      expect(result.jobId).toBe(1);
      expect(result.messageId).toBe(10);
    }
    expect(repo.createPendingMessageAndJob).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        role: 'user',
        content: '[voice:pending]',
        userId: 10,
        sourceType: 'voice',
        processingStatus: 'pending',
      }),
      expect.objectContaining({
        chatId: 1,
        telegramMessageId: 99,
        telegramFileId: 'file-id',
      })
    );
  });

  it('rejects when telegramFileId is empty', async () => {
    const { service } = makeService();
    const result = await service.enqueue({
      chatId: 1,
      telegramMessageId: 99,
      telegramFileId: '',
      user: { id: 10, fullName: 'Alice' },
      context: defaultContext,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.reason).toBe('missing_file_id');
    }
  });

  it('rejects when duration exceeds maxDurationSeconds', async () => {
    const { service } = makeService({ config: { maxDurationSeconds: 10 } });
    const result = await service.enqueue({
      chatId: 1,
      telegramMessageId: 99,
      telegramFileId: 'file-id',
      durationSeconds: 11,
      user: { id: 10, fullName: 'Alice' },
      context: defaultContext,
    });
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.reason).toBe('duration_too_long');
    }
  });

  it('does not call createPendingMessageAndJob on rejection', async () => {
    const { service, repo } = makeService();
    await service.enqueue({
      chatId: 1,
      telegramMessageId: 99,
      telegramFileId: '',
      user: { id: 10, fullName: 'Alice' },
      context: defaultContext,
    });
    expect(repo.createPendingMessageAndJob).not.toHaveBeenCalled();
  });
});
