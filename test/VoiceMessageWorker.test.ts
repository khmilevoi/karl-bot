import { describe, expect, it, vi } from 'vitest';
import type { VoiceTranscriptionJob } from '../src/domain/voice/VoiceTypes';
import type { VoiceTranscriptionJobRepository } from '../src/domain/repositories/VoiceTranscriptionJobRepository';
import type { MessageService } from '../src/application/interfaces/messages/MessageService';
import type { BehaviorPipeline } from '../src/application/behavior/BehaviorPipeline';
import type { VoiceConfig } from '../src/application/voice/VoiceConfig';
import type {
  TelegramFileDownloadService,
  TelegramDownloadedFile,
} from '../src/application/interfaces/voice/TelegramFileDownloadService';
import type {
  AudioConversionService,
  ConvertedAudioFile,
} from '../src/application/interfaces/voice/AudioConversionService';
import type { AudioTranscriptionService } from '../src/application/interfaces/voice/AudioTranscriptionService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { DefaultVoiceMessageWorker } from '../src/application/use-cases/voice/DefaultVoiceMessageWorker';

const now = '2026-06-03T00:00:00.000Z';

function makeJob(
  overrides: Partial<VoiceTranscriptionJob> = {}
): VoiceTranscriptionJob {
  return {
    id: 1,
    messageId: 10,
    chatId: 1,
    telegramMessageId: 99,
    telegramFileId: 'file-id',
    status: 'running',
    attempts: 1,
    availableAt: now,
    lockedUntil: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeJobRepo(
  overrides: Partial<VoiceTranscriptionJobRepository> = {}
): VoiceTranscriptionJobRepository {
  return {
    claimNext: vi.fn().mockResolvedValue(null),
    markDone: vi.fn().mockResolvedValue(undefined),
    requeue: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markCancelled: vi.fn().mockResolvedValue(undefined),
    createPendingMessageAndJob: vi.fn(),
    ...overrides,
  } as unknown as VoiceTranscriptionJobRepository;
}

const defaultDownloaded: TelegramDownloadedFile = {
  filename: 'voice.ogg',
  mimeType: 'audio/ogg',
  buffer: Buffer.from('audio'),
};

const defaultConverted: ConvertedAudioFile = {
  filename: 'voice.webm',
  mimeType: 'audio/webm',
  buffer: Buffer.from('converted'),
};

function makeLoggerFactory(): LoggerFactory {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return {
    create: vi.fn().mockReturnValue(logger),
  } as unknown as LoggerFactory;
}

function makeWorker(overrides: {
  repo?: VoiceTranscriptionJobRepository;
  messages?: Partial<MessageService>;
  behavior?: Partial<BehaviorPipeline>;
  download?: Partial<TelegramFileDownloadService>;
  convert?: Partial<AudioConversionService>;
  transcribe?: Partial<AudioTranscriptionService>;
  config?: Partial<VoiceConfig>;
}) {
  const config: VoiceConfig = {
    workerConcurrency: 1,
    workerPollIntervalMs: 1000,
    workerLockMs: 300_000,
    workerMaxAttempts: 3,
    transcriptionModel: 'gpt-4o-mini-transcribe',
    maxDurationSeconds: 120,
    ...overrides.config,
  };
  const repo =
    overrides.repo ??
    makeJobRepo({ claimNext: vi.fn().mockResolvedValue(null) });
  const messages = {
    markVoiceTranscribed: vi.fn().mockResolvedValue(null),
    markVoiceFailed: vi.fn().mockResolvedValue(undefined),
    addMessage: vi.fn(),
    getMessages: vi.fn(),
    getMessagesByIds: vi.fn(),
    getCount: vi.fn(),
    getLastMessages: vi.fn(),
    clearMessages: vi.fn(),
    findPendingVoiceById: vi.fn(),
    ...overrides.messages,
  } as unknown as MessageService;
  const behavior = {
    handleStoredMessage: vi.fn().mockResolvedValue({ kind: 'queued' }),
    ...overrides.behavior,
  } as unknown as BehaviorPipeline;
  const download = {
    download: vi.fn().mockResolvedValue(defaultDownloaded),
    ...overrides.download,
  } as unknown as TelegramFileDownloadService;
  const convert = {
    convertForTranscription: vi.fn().mockResolvedValue(defaultConverted),
    ...overrides.convert,
  } as unknown as AudioConversionService;
  const transcribe = {
    transcribe: vi.fn().mockResolvedValue('hello Carl'),
    ...overrides.transcribe,
  } as unknown as AudioTranscriptionService;
  const loggerFactory = makeLoggerFactory();

  return new DefaultVoiceMessageWorker(
    repo,
    messages,
    behavior,
    download,
    convert,
    transcribe,
    config,
    loggerFactory
  );
}

describe('DefaultVoiceMessageWorker', () => {
  it('processes a claimed voice job and sends the ready message to behavior pipeline', async () => {
    const job = makeJob({ attempts: 1 });
    const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(job) });
    const readyMessage = {
      id: job.messageId,
      chatId: job.chatId,
      role: 'user' as const,
      content: '[voice] hello Carl',
      sourceType: 'voice' as const,
      processingStatus: 'ready' as const,
    };
    const messages = {
      markVoiceTranscribed: vi.fn().mockResolvedValue(readyMessage),
      markVoiceFailed: vi.fn(),
    };
    const behavior = {
      handleStoredMessage: vi.fn().mockResolvedValue({ kind: 'queued' }),
    };
    const worker = makeWorker({ repo, messages, behavior });

    await worker.drainOnce();

    expect(messages.markVoiceTranscribed).toHaveBeenCalledWith(
      job.messageId,
      '[voice] hello Carl'
    );
    expect(behavior.handleStoredMessage).toHaveBeenCalledWith({
      message: expect.objectContaining({
        id: job.messageId,
        content: '[voice] hello Carl',
      }),
      directTrigger: null,
    });
    expect(repo.markDone).toHaveBeenCalledWith(job.id, expect.any(String));
  });

  it('marks job cancelled when markVoiceTranscribed returns null', async () => {
    const job = makeJob();
    const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(job) });
    const behavior = { handleStoredMessage: vi.fn() };
    const worker = makeWorker({
      repo,
      messages: {
        markVoiceTranscribed: vi.fn().mockResolvedValue(null),
        markVoiceFailed: vi.fn(),
      },
      behavior,
    });

    await worker.drainOnce();

    expect(repo.markCancelled).toHaveBeenCalledWith(
      job.id,
      expect.any(String),
      expect.any(String)
    );
    expect(behavior.handleStoredMessage).not.toHaveBeenCalled();
  });

  it('requeues with backoff on transient failure below max attempts', async () => {
    const job = makeJob({ attempts: 1 });
    const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(job) });
    const download = {
      download: vi.fn().mockRejectedValue(new Error('network')),
    };
    const worker = makeWorker({
      repo,
      download,
      config: { workerMaxAttempts: 3 },
    });

    await worker.drainOnce();

    expect(repo.requeue).toHaveBeenCalledWith(
      job.id,
      expect.any(String),
      'network',
      expect.any(String)
    );
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('marks job and message failed at max attempts', async () => {
    const job = makeJob({ attempts: 3 });
    const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(job) });
    const messages = {
      markVoiceFailed: vi.fn(),
      markVoiceTranscribed: vi.fn(),
    };
    const download = {
      download: vi.fn().mockRejectedValue(new Error('network')),
    };
    const worker = makeWorker({
      repo,
      messages,
      download,
      config: { workerMaxAttempts: 3 },
    });

    await worker.drainOnce();

    expect(repo.markFailed).toHaveBeenCalledWith(
      job.id,
      'network',
      expect.any(String)
    );
    expect(messages.markVoiceFailed).toHaveBeenCalledWith(job.messageId);
  });

  it('treats empty transcript as a transient failure', async () => {
    const job = makeJob({ attempts: 1 });
    const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(job) });
    const transcribe = { transcribe: vi.fn().mockResolvedValue('   ') };
    const worker = makeWorker({
      repo,
      transcribe,
      config: { workerMaxAttempts: 3 },
    });

    await worker.drainOnce();

    expect(repo.requeue).toHaveBeenCalled();
    expect(repo.markDone).not.toHaveBeenCalled();
  });

  it('returns immediately when no jobs are available', async () => {
    const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(null) });
    const behavior = { handleStoredMessage: vi.fn() };
    const worker = makeWorker({ repo, behavior });

    await worker.drainOnce();

    expect(behavior.handleStoredMessage).not.toHaveBeenCalled();
    expect(repo.markDone).not.toHaveBeenCalled();
  });
});
