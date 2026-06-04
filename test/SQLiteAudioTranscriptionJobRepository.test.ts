import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteAudioTranscriptionJobRepository } from '../src/infrastructure/persistence/sqlite/SQLiteAudioTranscriptionJobRepository';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => {
      const logger = {
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return logger;
        },
      };
      return logger;
    },
  }) as unknown as LoggerFactory;

describe('SQLiteAudioTranscriptionJobRepository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  async function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), 'audio-job-repo-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const env = new TestEnvService();
    const loggerFactory = createLoggerFactory();
    const provider = new SQLiteDbProviderImpl(env, loggerFactory);
    const repo = new SQLiteAudioTranscriptionJobRepository(provider);
    return { repo, provider };
  }

  it('create() inserts a queued job', async () => {
    const { repo } = await setup();

    const job = await repo.create({
      telegramFileId: 'file-id',
      availableAt: '2026-06-04T10:00:00.000Z',
    });

    expect(job).toEqual(
      expect.objectContaining({
        telegramFileId: 'file-id',
        status: 'queued',
        attempts: 0,
        lockedUntil: null,
        resultText: null,
        lastError: null,
      })
    );
    expect(typeof job.id).toBe('number');
  });

  it('claimNext() claims the oldest due job and increments attempts', async () => {
    const { repo } = await setup();

    const now = '2026-06-04T10:00:00.000Z';
    const availableAt = '2026-06-04T09:00:00.000Z';
    const lockedUntil = '2026-06-04T10:05:00.000Z';

    await repo.create({ telegramFileId: 'file-1', availableAt });

    const claimed = await repo.claimNext(now, lockedUntil);

    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.lockedUntil).toBe(lockedUntil);
    expect(claimed?.telegramFileId).toBe('file-1');
  });

  it('claimNext() returns null when no jobs are due', async () => {
    const { repo } = await setup();

    const futureAvailableAt = '2026-06-04T11:00:00.000Z';
    const now = '2026-06-04T10:00:00.000Z';
    const lockedUntil = '2026-06-04T10:05:00.000Z';

    await repo.create({
      telegramFileId: 'file-1',
      availableAt: futureAvailableAt,
    });

    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).toBeNull();
  });

  it('claimNext() can reclaim stale running jobs after locked_until', async () => {
    const { repo } = await setup();

    const availableAt = '2026-06-04T08:00:00.000Z';
    const staleLockUntil = '2026-06-04T09:00:00.000Z';
    const now = '2026-06-04T10:00:00.000Z';
    const newLockUntil = '2026-06-04T10:05:00.000Z';

    await repo.create({ telegramFileId: 'file-stale', availableAt });

    const first = await repo.claimNext(now, staleLockUntil);
    expect(first?.status).toBe('running');
    expect(first?.attempts).toBe(1);

    const second = await repo.claimNext(now, newLockUntil);
    expect(second?.status).toBe('running');
    expect(second?.attempts).toBe(2);
    expect(second?.lockedUntil).toBe(newLockUntil);
  });

  it('markDone() stores result_text and terminal status', async () => {
    const { repo, provider } = await setup();

    const now = '2026-06-04T10:00:00.000Z';
    const lockedUntil = '2026-06-04T10:05:00.000Z';
    const doneAt = '2026-06-04T10:01:00.000Z';

    await repo.create({
      telegramFileId: 'file-1',
      availableAt: '2026-06-04T09:00:00.000Z',
    });
    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).not.toBeNull();

    await repo.markDone(claimed!.id, 'hello world', doneAt);

    const db = await provider.get();
    const row = await db.get<{
      status: string;
      result_text: string | null;
      locked_until: string | null;
      updated_at: string;
    }>(
      'SELECT status, result_text, locked_until, updated_at FROM audio_transcription_jobs WHERE id = ?',
      claimed!.id
    );
    expect(row?.status).toBe('done');
    expect(row?.result_text).toBe('hello world');
    expect(row?.locked_until).toBeNull();
    expect(row?.updated_at).toBe(doneAt);
  });

  it('findById() returns terminal result for polling', async () => {
    const { repo } = await setup();

    const now = '2026-06-04T10:00:00.000Z';
    const lockedUntil = '2026-06-04T10:05:00.000Z';

    await repo.create({
      telegramFileId: 'file-1',
      availableAt: '2026-06-04T09:00:00.000Z',
    });
    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).not.toBeNull();

    await repo.markDone(claimed!.id, 'transcript text', now);

    const found = await repo.findById(claimed!.id);
    expect(found?.status).toBe('done');
    expect(found?.resultText).toBe('transcript text');
  });

  it('markFailed() stores last_error', async () => {
    const { repo, provider } = await setup();

    const now = '2026-06-04T10:00:00.000Z';
    const lockedUntil = '2026-06-04T10:05:00.000Z';
    const failedAt = '2026-06-04T10:01:00.000Z';

    await repo.create({
      telegramFileId: 'file-1',
      availableAt: '2026-06-04T09:00:00.000Z',
    });
    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).not.toBeNull();

    await repo.markFailed(claimed!.id, 'fatal error', failedAt);

    const db = await provider.get();
    const row = await db.get<{
      status: string;
      last_error: string | null;
      updated_at: string;
    }>(
      'SELECT status, last_error, updated_at FROM audio_transcription_jobs WHERE id = ?',
      claimed!.id
    );
    expect(row?.status).toBe('failed');
    expect(row?.last_error).toBe('fatal error');
    expect(row?.updated_at).toBe(failedAt);
  });

  it('requeue() changes status back to queued with new available_at and last_error', async () => {
    const { repo } = await setup();

    const now = '2026-06-04T10:00:00.000Z';
    const lockedUntil = '2026-06-04T10:05:00.000Z';
    const requeueAt = '2026-06-04T10:10:00.000Z';

    await repo.create({
      telegramFileId: 'file-1',
      availableAt: '2026-06-04T09:00:00.000Z',
    });
    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).not.toBeNull();

    await repo.requeue(claimed!.id, requeueAt, 'transient error', now);

    const reclaimed = await repo.claimNext(requeueAt, lockedUntil);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.status).toBe('running');
    expect(reclaimed?.lastError).toBe('transient error');
    expect(reclaimed?.attempts).toBe(2);
  });

  it('markCancelled() stores reason as last_error', async () => {
    const { repo, provider } = await setup();

    const now = '2026-06-04T10:00:00.000Z';
    const lockedUntil = '2026-06-04T10:05:00.000Z';
    const cancelledAt = '2026-06-04T10:02:00.000Z';

    await repo.create({
      telegramFileId: 'file-1',
      availableAt: '2026-06-04T09:00:00.000Z',
    });
    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).not.toBeNull();

    await repo.markCancelled(claimed!.id, 'user cancelled', cancelledAt);

    const db = await provider.get();
    const row = await db.get<{
      status: string;
      last_error: string | null;
      updated_at: string;
    }>(
      'SELECT status, last_error, updated_at FROM audio_transcription_jobs WHERE id = ?',
      claimed!.id
    );
    expect(row?.status).toBe('cancelled');
    expect(row?.last_error).toBe('user cancelled');
    expect(row?.updated_at).toBe(cancelledAt);
  });
});
