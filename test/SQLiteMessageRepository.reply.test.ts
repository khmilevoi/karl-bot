import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteMessageRepository } from '../src/infrastructure/persistence/sqlite/SQLiteMessageRepository';
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

describe('SQLiteMessageRepository reply columns', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  async function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), 'msg-reply-repo-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const env = new TestEnvService();
    const loggerFactory = createLoggerFactory();
    const provider = new SQLiteDbProviderImpl(env, loggerFactory);
    const repo = new SQLiteMessageRepository(provider);
    return { repo, provider };
  }

  it('round-trips reply target columns', async () => {
    const { repo } = await setup();

    const id = await repo.insert({
      chatId: -100,
      messageId: 10,
      role: 'user',
      content: 'ответ',
      userId: 7,
      replyText: 'orig',
      replyUsername: 'Анна',
      replyToMessageId: 555,
      replyToUserId: 42,
    });

    const [msg] = await repo.findByIds([id]);
    expect(msg.replyToMessageId).toBe(555);
    expect(msg.replyToUserId).toBe(42);
  });
});
