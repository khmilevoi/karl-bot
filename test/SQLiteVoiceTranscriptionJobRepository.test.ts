import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatEntity } from '../src/domain/entities/ChatEntity';
import { UserEntity } from '../src/domain/entities/UserEntity';
import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteChatRepository } from '../src/infrastructure/persistence/sqlite/SQLiteChatRepository';
import { SQLiteChatUserRepository } from '../src/infrastructure/persistence/sqlite/SQLiteChatUserRepository';
import { SQLiteUserRepository } from '../src/infrastructure/persistence/sqlite/SQLiteUserRepository';
import { SQLiteVoiceTranscriptionJobRepository } from '../src/infrastructure/persistence/sqlite/SQLiteVoiceTranscriptionJobRepository';
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

describe('SQLiteVoiceTranscriptionJobRepository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  async function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), 'voice-job-repo-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const env = new TestEnvService();
    const loggerFactory = createLoggerFactory();
    const provider = new SQLiteDbProviderImpl(env, loggerFactory);
    const chatRepo = new SQLiteChatRepository(provider);
    const userRepo = new SQLiteUserRepository(provider);
    const chatUserRepo = new SQLiteChatUserRepository(provider);
    const repo = new SQLiteVoiceTranscriptionJobRepository(
      provider,
      chatRepo,
      userRepo,
      chatUserRepo
    );
    return { repo, provider };
  }

  it('creates pending message and queued job atomically', async () => {
    const { repo } = await setup();

    const job = await repo.createPendingMessageAndJob(
      {
        chatId: 1,
        role: 'user',
        content: '[voice:pending]',
        userId: 10,
        messageId: 99,
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: 1,
        telegramMessageId: 99,
        telegramFileId: 'file-id',
        availableAt: '2026-06-03T00:00:00.000Z',
      }
    );

    expect(job).toEqual(
      expect.objectContaining({
        chatId: 1,
        telegramMessageId: 99,
        telegramFileId: 'file-id',
        status: 'queued',
        attempts: 0,
      })
    );
    expect(typeof job.id).toBe('number');
    expect(typeof job.messageId).toBe('number');
  });

  it('upserts chat, user, and chat-user link before inserting message', async () => {
    const { repo, provider } = await setup();

    await repo.createPendingMessageAndJob(
      {
        chatId: 42,
        role: 'user',
        content: '[voice:pending]',
        userId: 7,
        messageId: 101,
        chatTitle: 'Test Chat',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: 42,
        telegramMessageId: 101,
        telegramFileId: 'file-abc',
        availableAt: '2026-06-03T00:00:00.000Z',
      }
    );

    const db = await provider.get();
    const chat = await db.get<{ chat_id: number; title: string | null }>(
      'SELECT chat_id, title FROM chats WHERE chat_id = ?',
      42
    );
    const user = await db.get<{ id: number; username: string | null }>(
      'SELECT id, username FROM users WHERE id = ?',
      7
    );
    const link = await db.get<{ user_id: number }>(
      'SELECT user_id FROM chat_users WHERE chat_id = ? AND user_id = ?',
      42,
      7
    );

    expect(chat).toEqual({ chat_id: 42, title: 'Test Chat' });
    expect(user).toEqual(
      expect.objectContaining({ id: 7, username: 'testuser' })
    );
    expect(link).toEqual({ user_id: 7 });
  });

  it('claimNext returns the oldest due queued job and locks it', async () => {
    const { repo } = await setup();

    const now = '2026-06-03T10:00:00.000Z';
    const availableAt = '2026-06-03T09:00:00.000Z';
    const lockedUntil = '2026-06-03T10:05:00.000Z';

    await repo.createPendingMessageAndJob(
      {
        chatId: 1,
        role: 'user',
        content: '[voice:pending]',
        userId: 1,
        messageId: 1,
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: 1,
        telegramMessageId: 1,
        telegramFileId: 'file-1',
        availableAt,
      }
    );

    const claimed = await repo.claimNext(now, lockedUntil);

    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.lockedUntil).toBe(lockedUntil);
    expect(claimed?.telegramFileId).toBe('file-1');
  });

  it('claimNext returns null when no jobs are due', async () => {
    const { repo } = await setup();

    const futureTime = '2026-06-03T09:00:00.000Z';
    const currentTime = '2026-06-03T08:00:00.000Z';
    const lockedUntil = '2026-06-03T09:05:00.000Z';

    await repo.createPendingMessageAndJob(
      {
        chatId: 1,
        role: 'user',
        content: '[voice:pending]',
        userId: 1,
        messageId: 1,
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: 1,
        telegramMessageId: 1,
        telegramFileId: 'file-1',
        availableAt: futureTime,
      }
    );

    const claimed = await repo.claimNext(currentTime, lockedUntil);
    expect(claimed).toBeNull();
  });

  it('claimNext can reclaim stale running jobs whose locked_until is past', async () => {
    const { repo } = await setup();

    const pastAvailableAt = '2026-06-03T08:00:00.000Z';
    const staleLockUntil = '2026-06-03T09:00:00.000Z';
    const now = '2026-06-03T10:00:00.000Z';
    const newLockUntil = '2026-06-03T10:05:00.000Z';

    await repo.createPendingMessageAndJob(
      {
        chatId: 1,
        role: 'user',
        content: '[voice:pending]',
        userId: 1,
        messageId: 1,
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: 1,
        telegramMessageId: 1,
        telegramFileId: 'file-stale',
        availableAt: pastAvailableAt,
      }
    );

    // Claim first time
    const first = await repo.claimNext(now, staleLockUntil);
    expect(first?.status).toBe('running');
    expect(first?.attempts).toBe(1);

    // Simulate stale lock (lock expired), reclaim
    const second = await repo.claimNext(now, newLockUntil);
    expect(second?.status).toBe('running');
    expect(second?.attempts).toBe(2);
    expect(second?.lockedUntil).toBe(newLockUntil);
  });

  it('requeue changes status back to queued, sets available_at, and stores last_error', async () => {
    const { repo } = await setup();

    const availableAt = '2026-06-03T09:00:00.000Z';
    const now = '2026-06-03T10:00:00.000Z';
    const lockedUntil = '2026-06-03T10:05:00.000Z';
    const requeueAt = '2026-06-03T10:10:00.000Z';

    await repo.createPendingMessageAndJob(
      {
        chatId: 1,
        role: 'user',
        content: '[voice:pending]',
        userId: 1,
        messageId: 1,
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: 1,
        telegramMessageId: 1,
        telegramFileId: 'file-1',
        availableAt,
      }
    );

    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).not.toBeNull();

    await repo.requeue(claimed!.id, requeueAt, 'transient error', now);

    const reclaimed = await repo.claimNext(requeueAt, lockedUntil);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed?.status).toBe('running');
    expect(reclaimed?.lastError).toBe('transient error');
    expect(reclaimed?.attempts).toBe(2);
  });

  it('markDone updates status to done', async () => {
    const { repo, provider } = await setup();

    const availableAt = '2026-06-03T09:00:00.000Z';
    const now = '2026-06-03T10:00:00.000Z';
    const lockedUntil = '2026-06-03T10:05:00.000Z';

    await repo.createPendingMessageAndJob(
      {
        chatId: 1,
        role: 'user',
        content: '[voice:pending]',
        userId: 1,
        messageId: 1,
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: 1,
        telegramMessageId: 1,
        telegramFileId: 'file-1',
        availableAt,
      }
    );

    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).not.toBeNull();

    const doneAt = '2026-06-03T10:01:00.000Z';
    await repo.markDone(claimed!.id, doneAt);

    const db = await provider.get();
    const row = await db.get<{ status: string; updated_at: string }>(
      'SELECT status, updated_at FROM voice_transcription_jobs WHERE id = ?',
      claimed!.id
    );
    expect(row?.status).toBe('done');
    expect(row?.updated_at).toBe(doneAt);
  });

  it('markFailed updates status to failed with error', async () => {
    const { repo, provider } = await setup();

    const availableAt = '2026-06-03T09:00:00.000Z';
    const now = '2026-06-03T10:00:00.000Z';
    const lockedUntil = '2026-06-03T10:05:00.000Z';

    await repo.createPendingMessageAndJob(
      {
        chatId: 1,
        role: 'user',
        content: '[voice:pending]',
        userId: 1,
        messageId: 1,
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: 1,
        telegramMessageId: 1,
        telegramFileId: 'file-1',
        availableAt,
      }
    );

    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).not.toBeNull();

    const failedAt = '2026-06-03T10:01:00.000Z';
    await repo.markFailed(claimed!.id, 'fatal error', failedAt);

    const db = await provider.get();
    const row = await db.get<{
      status: string;
      last_error: string | null;
      updated_at: string;
    }>(
      'SELECT status, last_error, updated_at FROM voice_transcription_jobs WHERE id = ?',
      claimed!.id
    );
    expect(row?.status).toBe('failed');
    expect(row?.last_error).toBe('fatal error');
    expect(row?.updated_at).toBe(failedAt);
  });

  it('markCancelled updates status to cancelled and stores reason', async () => {
    const { repo, provider } = await setup();

    const availableAt = '2026-06-03T09:00:00.000Z';
    const now = '2026-06-03T10:00:00.000Z';
    const lockedUntil = '2026-06-03T10:05:00.000Z';

    await repo.createPendingMessageAndJob(
      {
        chatId: 1,
        role: 'user',
        content: '[voice:pending]',
        userId: 1,
        messageId: 1,
        sourceType: 'voice',
        processingStatus: 'pending',
      },
      {
        chatId: 1,
        telegramMessageId: 1,
        telegramFileId: 'file-1',
        availableAt,
      }
    );

    const claimed = await repo.claimNext(now, lockedUntil);
    expect(claimed).not.toBeNull();

    const cancelledAt = '2026-06-03T10:02:00.000Z';
    await repo.markCancelled(claimed!.id, 'user cancelled', cancelledAt);

    const db = await provider.get();
    const row = await db.get<{
      status: string;
      last_error: string | null;
      updated_at: string;
    }>(
      'SELECT status, last_error, updated_at FROM voice_transcription_jobs WHERE id = ?',
      claimed!.id
    );
    expect(row?.status).toBe('cancelled');
    expect(row?.last_error).toBe('user cancelled');
    expect(row?.updated_at).toBe(cancelledAt);
  });
});
