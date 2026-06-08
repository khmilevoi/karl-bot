import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteFactCheckWindowRepository } from '../src/infrastructure/persistence/sqlite/SQLiteFactCheckWindowRepository';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => ({
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    }),
  }) as unknown as LoggerFactory;

describe('SQLiteFactCheckWindowRepository', () => {
  let repo: SQLiteFactCheckWindowRepository;

  beforeEach(async () => {
    vi.resetModules();
    const dir = mkdtempSync(path.join(tmpdir(), 'fact-window-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const env = new TestEnvService();
    const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
    repo = new SQLiteFactCheckWindowRepository(provider);
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('returns null for missing chat', async () => {
    const result = await repo.get(999);
    expect(result).toBeNull();
  });

  it('upserts and retrieves window', async () => {
    const now = new Date().toISOString();
    await repo.upsert({
      chatId: 1,
      lastCheckedMessageId: 42,
      lastCheckedAt: now,
      updatedAt: now,
    });
    const result = await repo.get(1);
    expect(result).not.toBeNull();
    expect(result?.chatId).toBe(1);
    expect(result?.lastCheckedMessageId).toBe(42);
  });

  it('updates lastCheckedMessageId on second upsert', async () => {
    const now = new Date().toISOString();
    await repo.upsert({
      chatId: 1,
      lastCheckedMessageId: 10,
      lastCheckedAt: null,
      updatedAt: now,
    });
    await repo.upsert({
      chatId: 1,
      lastCheckedMessageId: 20,
      lastCheckedAt: now,
      updatedAt: now,
    });
    const result = await repo.get(1);
    expect(result?.lastCheckedMessageId).toBe(20);
  });
});
