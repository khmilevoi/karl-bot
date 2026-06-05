import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteAiErrorEventRepository } from '../src/infrastructure/persistence/sqlite/SQLiteAiErrorEventRepository';
import { SQLiteBehaviorEventRepository } from '../src/infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository';
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

let behaviorRepo: SQLiteBehaviorEventRepository;
let errorRepo: SQLiteAiErrorEventRepository;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-events-'));
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
  await db.run('INSERT INTO chats (chat_id) VALUES (1)');
  await db.close();

  const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
  behaviorRepo = new SQLiteBehaviorEventRepository(provider);
  errorRepo = new SQLiteAiErrorEventRepository(provider);
});

describe('behavior event repositories', () => {
  it('inserts and reads a behavior event, preserving the escalated boolean', async () => {
    const id = await behaviorRepo.insert({
      chatId: 1,
      schemaVersion: 'v1',
      gateReason: 'conflict',
      gateConfidence: 0.8,
      gateStateImpactRisk: 'high',
      triggerMessageIdsJson: '[10]',
      contextMessageIdsJson: '[9]',
      modelSlot: 'behaviorDecision',
      selectedModel: 'gpt-5.5',
      escalated: true,
      escalationReason: 'high_risk',
      actionsJson: '[]',
      actionResultsJson: '[]',
      statePatchesJson: '[]',
      patchResultsJson: '[]',
      confidence: 0.9,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      latencyMs: 543,
      createdAt: '2026-05-29T00:00:00.000Z',
    });
    const loaded = await behaviorRepo.findById(id);
    expect(loaded?.escalated).toBe(true);
    expect(loaded?.modelSlot).toBe('behaviorDecision');
    expect((await behaviorRepo.findByChatId(1)).length).toBe(1);
  });

  it('findByChatIdAfter returns only events with id > afterId ordered by id', async () => {
    const mkEvent = (slot: string) => ({
      chatId: 1,
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
    const id1 = await behaviorRepo.insert(mkEvent('behaviorDecision'));
    const id2 = await behaviorRepo.insert(mkEvent('behaviorDecision'));
    const id3 = await behaviorRepo.insert(mkEvent('stateEvolution'));

    const after1 = await behaviorRepo.findByChatIdAfter(1, id1);
    expect(after1.map((e) => e.id)).toEqual([id2, id3]);

    const count = await behaviorRepo.countByChatIdAfter(1, id1);
    expect(count).toBe(2);

    const afterAll = await behaviorRepo.findByChatIdAfter(1, id3);
    expect(afterAll).toHaveLength(0);
    expect(await behaviorRepo.countByChatIdAfter(1, id3)).toBe(0);
  });

  it('inserts and reads an AI error event with a null chatId', async () => {
    const id = await errorRepo.insert({
      chatId: null,
      source: 'behavior_decision_parse',
      severity: 'error',
      errorCode: 'INVALID_JSON',
      message: 'could not parse',
      component: 'CarlBehaviorModelService',
      operation: 'decideBehavior',
      inputRefJson: null,
      outputRefJson: '{"raw":"..."}',
      stackHash: 'abc123',
      fixHint: 'retry with stricter schema',
      status: 'open',
      createdAt: '2026-05-29T00:00:00.000Z',
    });
    const loaded = await errorRepo.findById(id);
    expect(loaded?.chatId).toBeNull();
    expect(loaded?.errorCode).toBe('INVALID_JSON');
    expect(loaded?.status).toBe('open');
  });
});
