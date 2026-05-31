import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteBehaviorEventRepository } from '../src/infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository';
import { SQLiteStateEvolutionCursorRepository } from '../src/infrastructure/persistence/sqlite/SQLiteStateEvolutionCursorRepository';
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

let cursorRepo: SQLiteStateEvolutionCursorRepository;
let eventRepo: SQLiteBehaviorEventRepository;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cursor-'));
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
  await db.run('INSERT INTO chats (chat_id) VALUES (2)');
  await db.close();

  const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
  cursorRepo = new SQLiteStateEvolutionCursorRepository(provider);
  eventRepo = new SQLiteBehaviorEventRepository(provider);
});

const mkEvent = (chatId: number, slot = 'behaviorDecision') => ({
  chatId,
  schemaVersion: 'v1',
  gateReason: null,
  gateConfidence: null,
  gateStateImpactRisk: null,
  triggerMessageIdsJson: '[]',
  contextMessageIdsJson: '[]',
  modelSlot: slot,
  selectedModel: 'gpt-4o',
  escalated: false,
  escalationReason: null,
  actionsJson: '[]',
  actionResultsJson: '[]',
  statePatchesJson: '[]',
  patchResultsJson: '[]',
  confidence: 0.5,
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
  latencyMs: null,
  createdAt: new Date().toISOString(),
});

const past = '2026-01-01T00:00:00.000Z';
const now = '2026-05-31T12:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';

describe('SQLiteStateEvolutionCursorRepository', () => {
  it('round-trips a cursor via get + upsert', async () => {
    expect(await cursorRepo.get(1)).toBeUndefined();
    await cursorRepo.upsert({ chatId: 1, lastEventId: 5, lastRunAt: now });
    const loaded = await cursorRepo.get(1);
    expect(loaded?.chatId).toBe(1);
    expect(loaded?.lastEventId).toBe(5);
    expect(loaded?.lastRunAt).toBe(now);
  });

  it('upsert updates an existing cursor', async () => {
    await cursorRepo.upsert({ chatId: 1, lastEventId: 3, lastRunAt: past });
    await cursorRepo.upsert({ chatId: 1, lastEventId: 10, lastRunAt: now });
    const loaded = await cursorRepo.get(1);
    expect(loaded?.lastEventId).toBe(10);
    expect(loaded?.lastRunAt).toBe(now);
  });

  it('preserves null lastRunAt', async () => {
    await cursorRepo.upsert({ chatId: 1, lastEventId: 0, lastRunAt: null });
    const loaded = await cursorRepo.get(1);
    expect(loaded?.lastRunAt).toBeNull();
  });

  it('findChatsNeedingSweep returns chat with events beyond cursor and stale lastRunAt', async () => {
    // chat 1: has a new event, cursor is stale
    const id1 = await eventRepo.insert(mkEvent(1));
    await cursorRepo.upsert({
      chatId: 1,
      lastEventId: id1 - 1,
      lastRunAt: past,
    });

    // chat 2: has events but cursor is caught up and recently run
    const id2 = await eventRepo.insert(mkEvent(2));
    await cursorRepo.upsert({ chatId: 2, lastEventId: id2, lastRunAt: now });

    const chats = await cursorRepo.findChatsNeedingSweep(future);
    expect(chats).toContain(1);
    expect(chats).not.toContain(2);
  });

  it('findChatsNeedingSweep includes chat with null lastRunAt', async () => {
    await eventRepo.insert(mkEvent(1));
    await cursorRepo.upsert({ chatId: 1, lastEventId: 0, lastRunAt: null });
    const chats = await cursorRepo.findChatsNeedingSweep(future);
    expect(chats).toContain(1);
  });

  it('findChatsNeedingSweep excludes chat with no new events', async () => {
    const id = await eventRepo.insert(mkEvent(1));
    await cursorRepo.upsert({ chatId: 1, lastEventId: id, lastRunAt: past });
    const chats = await cursorRepo.findChatsNeedingSweep(future);
    expect(chats).not.toContain(1);
  });
});
