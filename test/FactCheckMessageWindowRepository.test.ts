import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteFactCheckMessageWindowRepository } from '../src/infrastructure/persistence/sqlite/SQLiteFactCheckMessageWindowRepository';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { SqlDatabase } from '../src/domain/repositories/DbProvider';

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

describe('SQLiteFactCheckMessageWindowRepository', () => {
  let repo: SQLiteFactCheckMessageWindowRepository;
  let db: SqlDatabase;

  beforeEach(async () => {
    vi.resetModules();
    const dir = mkdtempSync(path.join(tmpdir(), 'fact-msg-window-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const env = new TestEnvService();
    const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
    db = await provider.get();
    repo = new SQLiteFactCheckMessageWindowRepository(provider);
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  async function insertMessage(
    chatId: number,
    status: 'ready' | 'pending' | 'failed' = 'ready'
  ): Promise<number> {
    const result = (await db.run(
      "INSERT INTO messages (chat_id, message_id, role, content, user_id, source_type, processing_status) VALUES (?, NULL, 'user', 'hi', 0, 'text', ?)",
      chatId,
      status
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  it('returns messages after a given id', async () => {
    await insertMessage(1); // id=1
    await insertMessage(1); // id=2
    await insertMessage(1); // id=3

    const batch = await repo.findReadyByChatIdAfterId(1, 1, 10);
    expect(batch.map((m) => m.id)).toEqual([2, 3]);
  });

  it('returns context before a given id in ascending order', async () => {
    await insertMessage(1); // id=1
    await insertMessage(1); // id=2
    await insertMessage(1); // id=3

    const context = await repo.findReadyContextBeforeId(1, 3, 2);
    expect(context.map((m) => m.id)).toEqual([1, 2]);
  });

  it('stops before a pending hole (leapfrog fix)', async () => {
    await insertMessage(1, 'ready'); // id=1
    await insertMessage(1, 'pending'); // id=2 - hole
    await insertMessage(1, 'ready'); // id=3

    // Only contiguous ready prefix before the pending hole
    const firstPass = await repo.findReadyByChatIdAfterId(1, 0, 10);
    expect(firstPass.map((m) => m.id)).toEqual([1]);
  });

  it('continues after pending becomes ready', async () => {
    await insertMessage(1, 'ready'); // id=1
    await insertMessage(1, 'pending'); // id=2
    await insertMessage(1, 'ready'); // id=3

    // Simulate id=2 transcribed to ready
    await db.run(
      "UPDATE messages SET processing_status = 'ready' WHERE id = ?",
      2
    );

    const secondPass = await repo.findReadyByChatIdAfterId(1, 1, 10);
    expect(secondPass.map((m) => m.id)).toEqual([2, 3]);
  });

  it('treats failed messages as passable (not a hole)', async () => {
    await insertMessage(1, 'ready'); // id=1
    await insertMessage(1, 'failed'); // id=2 - not a hole
    await insertMessage(1, 'ready'); // id=3

    const batch = await repo.findReadyByChatIdAfterId(1, 0, 10);
    expect(batch.map((m) => m.id)).toEqual([1, 3]);
  });
});
