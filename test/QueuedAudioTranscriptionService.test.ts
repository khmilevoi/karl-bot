import { describe, expect, it, vi } from 'vitest';

import type { AudioTranscriptionJobRepository } from '../src/domain/repositories/AudioTranscriptionJobRepository';
import type { AudioTranscriptionJob } from '../src/domain/voice/AudioTranscriptionJobTypes';
import type { VoiceConfig } from '../src/application/voice/VoiceConfig';
import { DefaultQueuedAudioTranscriptionService } from '../src/application/use-cases/voice/DefaultQueuedAudioTranscriptionService';

const now = '2026-06-04T10:00:00.000Z';

function makeJob(
  overrides: Partial<AudioTranscriptionJob> = {}
): AudioTranscriptionJob {
  return {
    id: 1,
    telegramFileId: 'file-id',
    status: 'queued',
    attempts: 0,
    availableAt: now,
    lockedUntil: null,
    resultText: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRepo(
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

function makeConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    workerConcurrency: 1,
    workerPollIntervalMs: 1000,
    workerLockMs: 300_000,
    workerMaxAttempts: 3,
    transcriptionModel: 'gpt-4o-mini-transcribe',
    maxDurationSeconds: 120,
    transcriptionWaitTimeoutMs: 5000,
    transcriptionResultPollIntervalMs: 100,
    ...overrides,
  };
}

function makeService(
  repo: AudioTranscriptionJobRepository,
  config: VoiceConfig = makeConfig()
) {
  return new DefaultQueuedAudioTranscriptionService(repo, config);
}

describe('DefaultQueuedAudioTranscriptionService', () => {
  it('creates a queued job and resolves when findById returns done with resultText', async () => {
    const doneJob = makeJob({ id: 1, status: 'done', resultText: 'hello' });
    const repo = makeRepo({
      create: vi.fn().mockResolvedValue(makeJob({ id: 1 })),
      findById: vi.fn().mockResolvedValue(doneJob),
    });
    const service = makeService(repo);

    vi.useFakeTimers();
    const promise = service.transcribe({ telegramFileId: 'file-id' });
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe('hello');
    vi.useRealTimers();
  });

  it('rejects when terminal status is failed', async () => {
    const failedJob = makeJob({ id: 1, status: 'failed', lastError: 'oops' });
    const repo = makeRepo({
      create: vi.fn().mockResolvedValue(makeJob({ id: 1 })),
      findById: vi.fn().mockResolvedValue(failedJob),
    });
    const service = makeService(repo);

    vi.useFakeTimers();
    const promise = service.transcribe({ telegramFileId: 'file-id' });
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toThrow();
    vi.useRealTimers();
  });

  it('rejects when terminal status is cancelled', async () => {
    const cancelledJob = makeJob({
      id: 1,
      status: 'cancelled',
      lastError: 'cancelled',
    });
    const repo = makeRepo({
      create: vi.fn().mockResolvedValue(makeJob({ id: 1 })),
      findById: vi.fn().mockResolvedValue(cancelledJob),
    });
    const service = makeService(repo);

    vi.useFakeTimers();
    const promise = service.transcribe({ telegramFileId: 'file-id' });
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toThrow();
    vi.useRealTimers();
  });

  it('rejects on timeout if worker never finishes', async () => {
    const pendingJob = makeJob({ id: 1, status: 'queued' });
    const repo = makeRepo({
      create: vi.fn().mockResolvedValue(pendingJob),
      findById: vi.fn().mockResolvedValue(pendingJob),
    });
    const config = makeConfig({
      transcriptionWaitTimeoutMs: 500,
      transcriptionResultPollIntervalMs: 100,
    });
    const service = makeService(repo, config);

    vi.useFakeTimers();
    const promise = service.transcribe({ telegramFileId: 'file-id' });
    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).rejects.toThrow(/timeout/i);
    vi.useRealTimers();
  });

  it('rejects immediately when telegramFileId is empty', async () => {
    const repo = makeRepo();
    const service = makeService(repo);

    await expect(service.transcribe({ telegramFileId: '' })).rejects.toThrow();
  });

  it('rejects when duration exceeds maxDurationSeconds', async () => {
    const repo = makeRepo();
    const config = makeConfig({ maxDurationSeconds: 60 });
    const service = makeService(repo, config);

    await expect(
      service.transcribe({ telegramFileId: 'file-id', durationSeconds: 120 })
    ).rejects.toThrow(/duration/i);
  });
});
