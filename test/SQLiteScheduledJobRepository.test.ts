import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { DueSlot } from '../src/domain/scheduler/ScheduledJobTypes';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteScheduledJobRepository } from '../src/infrastructure/persistence/sqlite/SQLiteScheduledJobRepository';

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

const slot = (overrides: Partial<DueSlot> = {}): DueSlot => ({
  jobName: 'fact-check',
  slotKey: 'fact-check:2026-06-08T14',
  payloadJson: '{}',
  runAfter: '2026-06-08T14:00:00.000Z',
  ...overrides,
});

describe('SQLiteScheduledJobRepository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  async function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), 'scheduled-job-repo-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const env = new TestEnvService();
    const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
    const repo = new SQLiteScheduledJobRepository(provider);
    return { repo };
  }

  it('insertDueSlot is idempotent on (job_name, slot_key)', async () => {
    const { repo } = await setup();
    const now = '2026-06-08T14:00:00.000Z';

    await repo.insertDueSlot(slot(), 5, now);
    await repo.insertDueSlot(slot(), 5, now);

    const found = await repo.findBySlot(
      'fact-check',
      'fact-check:2026-06-08T14'
    );
    expect(found).not.toBeNull();
    expect(found?.status).toBe('pending');
    expect(found?.attempts).toBe(0);
  });

  it('claimNext claims a pending row and increments attempts', async () => {
    const { repo } = await setup();
    const now = '2026-06-08T14:00:00.000Z';
    const lockedUntil = '2026-06-08T14:10:00.000Z';

    await repo.insertDueSlot(slot(), 5, now);
    const claimed = await repo.claimNext(now, lockedUntil);

    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.lockedUntil).toBe(lockedUntil);
  });

  it('claimNext returns null when nothing is due', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(
      slot({ runAfter: '2026-06-08T20:00:00.000Z' }),
      5,
      '2026-06-08T14:00:00.000Z'
    );
    const claimed = await repo.claimNext(
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:10:00.000Z'
    );
    expect(claimed).toBeNull();
  });

  it('claimNext does not double-claim the same row', async () => {
    const { repo } = await setup();
    const now = '2026-06-08T14:00:00.000Z';
    const lockedUntil = '2026-06-08T14:10:00.000Z';

    await repo.insertDueSlot(slot(), 5, now);
    const first = await repo.claimNext(now, lockedUntil);
    const second = await repo.claimNext(now, lockedUntil);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('claimNext reclaims a stale running row after locked_until', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(slot(), 5, '2026-06-08T14:00:00.000Z');

    const staleLock = '2026-06-08T14:01:00.000Z';
    const first = await repo.claimNext('2026-06-08T14:00:00.000Z', staleLock);
    expect(first?.attempts).toBe(1);

    const later = '2026-06-08T14:05:00.000Z';
    const newLock = '2026-06-08T14:15:00.000Z';
    const second = await repo.claimNext(later, newLock);
    expect(second?.attempts).toBe(2);
    expect(second?.lockedUntil).toBe(newLock);
  });

  it('scheduleRetry makes the row due again at run_after', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(slot(), 5, '2026-06-08T14:00:00.000Z');
    const claimed = await repo.claimNext(
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:10:00.000Z'
    );

    await repo.scheduleRetry(
      claimed!.id,
      '2026-06-08T14:30:00.000Z',
      'HTTP 500',
      '2026-06-08T14:00:30.000Z'
    );

    const stillTooEarly = await repo.claimNext(
      '2026-06-08T14:20:00.000Z',
      '2026-06-08T14:40:00.000Z'
    );
    expect(stillTooEarly).toBeNull();

    const dueNow = await repo.claimNext(
      '2026-06-08T14:31:00.000Z',
      '2026-06-08T14:41:00.000Z'
    );
    expect(dueNow?.status).toBe('running');
    expect(dueNow?.attempts).toBe(2);
    expect(dueNow?.lastError).toBe('HTTP 500');
  });

  it('markSucceeded sets terminal state and clears lock/error', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(slot(), 5, '2026-06-08T14:00:00.000Z');
    const claimed = await repo.claimNext(
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:10:00.000Z'
    );

    await repo.markSucceeded(claimed!.id, '2026-06-08T14:02:00.000Z');

    const found = await repo.findBySlot(
      'fact-check',
      'fact-check:2026-06-08T14'
    );
    expect(found?.status).toBe('succeeded');
    expect(found?.finishedAt).toBe('2026-06-08T14:02:00.000Z');
    expect(found?.lockedUntil).toBeNull();
    expect(found?.lastError).toBeNull();
  });

  it('markFailed sets terminal failed state with last_error', async () => {
    const { repo } = await setup();
    await repo.insertDueSlot(slot(), 5, '2026-06-08T14:00:00.000Z');
    const claimed = await repo.claimNext(
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:10:00.000Z'
    );

    await repo.markFailed(claimed!.id, 'boom', '2026-06-08T14:03:00.000Z');

    const found = await repo.findBySlot(
      'fact-check',
      'fact-check:2026-06-08T14'
    );
    expect(found?.status).toBe('failed');
    expect(found?.finishedAt).toBe('2026-06-08T14:03:00.000Z');
    expect(found?.lastError).toBe('boom');
    expect(found?.lockedUntil).toBeNull();
  });
});
