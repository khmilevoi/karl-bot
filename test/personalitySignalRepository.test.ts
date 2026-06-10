import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { personalitySignalSchema } from '../src/domain/behavior/schemas/state';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLitePersonalitySignalRepository } from '../src/infrastructure/persistence/sqlite/SQLitePersonalitySignalRepository';
import { parseDatabaseUrl } from '../src/utils/database';

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

let repo: SQLitePersonalitySignalRepository;
let provider: SQLiteDbProviderImpl;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'personality-signal-'));
  const dbFile = path.join(dir, 'test.db');
  process.env.DATABASE_URL = `file://${dbFile}`;
  const env = new TestEnvService();
  const filename = parseDatabaseUrl(env.env.DATABASE_URL);
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
  `);
  await db.exec(
    readFileSync(
      path.join('migrations', '015_create_behavior_tables.up.sql'),
      'utf8'
    )
  );
  await db.exec(
    readFileSync(path.join('migrations', '016_state_evolution.up.sql'), 'utf8')
  );
  await db.run('INSERT INTO chats (chat_id) VALUES (1)');
  await db.close();

  provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
  repo = new SQLitePersonalitySignalRepository(provider);
});

describe('SQLitePersonalitySignalRepository', () => {
  it('inserts two signals and returns them ordered by id', async () => {
    const now = '2026-05-31T00:00:00.000Z';
    const id1 = await repo.add({
      chatId: 1,
      area: 'identity',
      polarity: 'reinforce',
      text: 'curious and analytical',
      evidenceMessageIds: [10, 20],
      status: 'active',
      createdAt: now,
    });
    const id2 = await repo.add({
      chatId: 1,
      area: 'values',
      polarity: 'soften',
      text: 'less blunt',
      evidenceMessageIds: [30],
      status: 'active',
      createdAt: now,
    });

    expect(id1).toBeGreaterThan(0);
    expect(id2).toBeGreaterThan(id1);

    const signals = await repo.findByChatId(1);
    expect(signals).toHaveLength(2);
    expect(signals[0].area).toBe('identity');
    expect(signals[0].evidenceMessageIds).toEqual([10, 20]);
    expect(signals[1].area).toBe('values');
    expect(signals[1].evidenceMessageIds).toEqual([30]);
  });

  it('throws on parse when a row has a corrupt status', async () => {
    const db = await provider.get();
    await db.run(
      `INSERT INTO bot_personality_signals
        (chat_id, area, polarity, text, evidence_message_ids_json, status, created_at)
       VALUES (1, 'identity', 'reinforce', 'bad row', '[]', 'bad_status', '2026-05-31T00:00:00.000Z')`
    );
    await expect(repo.findByChatId(1)).rejects.toThrow();
  });

  it('returns empty array when no signals exist for a chat', async () => {
    const signals = await repo.findByChatId(1);
    expect(signals).toHaveLength(0);
  });
});

// Direct Zod schema parse guard — confirms personalitySignalSchema rejects bad status
describe('personalitySignalSchema parse guard', () => {
  it('rejects an invalid status value', () => {
    expect(() =>
      personalitySignalSchema.parse({
        area: 'identity',
        polarity: 'reinforce',
        text: 'test',
        evidenceMessageIds: [],
        status: 'bad_status',
        createdAt: '2026-05-31T00:00:00.000Z',
      })
    ).toThrow();
  });
});
