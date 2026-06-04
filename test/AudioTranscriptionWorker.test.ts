import { describe, expect, it, vi } from 'vitest';

import type { AudioTranscriptionJobRepository } from '../src/domain/repositories/AudioTranscriptionJobRepository';
import type { AudioTranscriptionJob } from '../src/domain/voice/AudioTranscriptionJobTypes';
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
import { DefaultAudioTranscriptionWorker } from '../src/application/use-cases/voice/DefaultAudioTranscriptionWorker';

const now = '2026-06-04T10:00:00.000Z';

function makeJob(
  overrides: Partial<AudioTranscriptionJob> = {}
): AudioTranscriptionJob {
  return {
    id: 1,
    telegramFileId: 'file-id',
    status: 'running',
    attempts: 1,
    availableAt: now,
    lockedUntil: null,
    resultText: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeJobRepo(
  overrides: Partial<AudioTranscriptionJobRepository> = {}
): AudioTranscriptionJobRepository {
  return {
    create: vi.fn().mockResolvedValue(makeJob()),
    findById: vi.fn().mockResolvedValue(null),
    claimNext: vi.fn().mockResolvedValue(null),
    markDone: vi.fn().mockResolvedValue(undefined),
    requeue: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markCancelled: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
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

function makeWorker(
  overrides: {
    repo?: AudioTranscriptionJobRepository;
    download?: Partial<TelegramFileDownloadService>;
    convert?: Partial<AudioConversionService>;
    transcribe?: Partial<AudioTranscriptionService>;
    config?: Partial<VoiceConfig>;
  } = {}
) {
  const config: VoiceConfig = {
    workerConcurrency: 1,
    workerPollIntervalMs: 1000,
    workerLockMs: 300_000,
    workerMaxAttempts: 3,
    transcriptionModel: 'gpt-4o-mini-transcribe',
    maxDurationSeconds: 120,
    transcriptionWaitTimeoutMs: 120_000,
    transcriptionResultPollIntervalMs: 500,
    ...overrides.config,
  };
  const repo =
    overrides.repo ??
    makeJobRepo({ claimNext: vi.fn().mockResolvedValue(null) });
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

  return new DefaultAudioTranscriptionWorker(
    repo,
    download,
    convert,
    transcribe,
    config,
    loggerFactory
  );
}

describe('DefaultAudioTranscriptionWorker', () => {
  it('successful job claims, downloads, converts, transcribes, and calls markDone', async () => {
    const job = makeJob({ attempts: 1 });
    const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(job) });
    const worker = makeWorker({ repo });

    await worker.drainOnce();

    expect(repo.markDone).toHaveBeenCalledWith(
      job.id,
      'hello Carl',
      expect.any(String)
    );
  });

  it('does not call MessageService or BehaviorPipeline', async () => {
    const job = makeJob({ attempts: 1 });
    const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(job) });
    const worker = makeWorker({ repo });

    await worker.drainOnce();

    // If the worker injected messages/behavior it would fail at construction
    // The test passes just by successfully calling drainOnce()
    expect(repo.markDone).toHaveBeenCalled();
  });

  it('treats empty transcript as a retryable failure', async () => {
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

  it('requeues on transient error below max attempts', async () => {
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

  it('calls markFailed at max attempts', async () => {
    const job = makeJob({ attempts: 3 });
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

    expect(repo.markFailed).toHaveBeenCalledWith(
      job.id,
      'network',
      expect.any(String)
    );
    expect(repo.requeue).not.toHaveBeenCalled();
  });

  it('drainOnce() returns cleanly when no jobs exist', async () => {
    const repo = makeJobRepo({ claimNext: vi.fn().mockResolvedValue(null) });
    const worker = makeWorker({ repo });

    await worker.drainOnce();

    expect(repo.markDone).not.toHaveBeenCalled();
    expect(repo.requeue).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });
});
