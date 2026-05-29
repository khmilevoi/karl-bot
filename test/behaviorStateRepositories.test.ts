import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLitePersonalityStateRepository } from '../src/infrastructure/persistence/sqlite/SQLitePersonalityStateRepository';
import { SQLitePoliticalStateRepository } from '../src/infrastructure/persistence/sqlite/SQLitePoliticalStateRepository';
import { SQLiteTruthRepository } from '../src/infrastructure/persistence/sqlite/SQLiteTruthRepository';
import { SQLiteUserSocialProfileRepository } from '../src/infrastructure/persistence/sqlite/SQLiteUserSocialProfileRepository';
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

let personalityRepo: SQLitePersonalityStateRepository;
let politicalRepo: SQLitePoliticalStateRepository;
let profileRepo: SQLiteUserSocialProfileRepository;
let truthRepo: SQLiteTruthRepository;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-state-'));
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
  await db.run('INSERT INTO users (id, username) VALUES (10, ?)', 'alice');
  await db.close();

  const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
  personalityRepo = new SQLitePersonalityStateRepository(provider);
  politicalRepo = new SQLitePoliticalStateRepository(provider);
  profileRepo = new SQLiteUserSocialProfileRepository(provider);
  truthRepo = new SQLiteTruthRepository(provider);
});

describe('behavior state repositories', () => {
  it('round-trips a personality state', async () => {
    const now = '2026-05-29T00:00:00.000Z';
    await personalityRepo.upsert({
      chatId: 1,
      identityNotes: ['curious'],
      values: ['honesty'],
      speechStyle: {
        tone: 'dry',
        humor: 'sarcastic',
        verbosity: 'short',
        formality: 'low',
      },
      socialHabits: ['lurks'],
      recurringThemes: ['cats'],
      lastUpdatedAt: now,
    });
    const loaded = await personalityRepo.findByChatId(1);
    expect(loaded?.values).toEqual(['honesty']);
    expect(loaded?.speechStyle.verbosity).toBe('short');
  });

  it('returns undefined for a missing personality state (neutral blank slate)', async () => {
    expect(await personalityRepo.findByChatId(999)).toBeUndefined();
  });

  it('round-trips a political state with positions', async () => {
    const now = '2026-05-29T00:00:00.000Z';
    await politicalRepo.upsert({
      chatId: 1,
      ideologySummary: 'leans communitarian',
      positions: [
        {
          id: 1,
          topic: 'taxes',
          stance: 'progressive',
          intensity: 'moderate',
          confidence: 0.6,
          status: 'active',
          evidenceMessageIds: [5],
          opposingEvidenceMessageIds: [],
          origin: 'chat_discussion',
          updatedAt: now,
        },
      ],
      uncertaintyAreas: ['trade'],
      influenceHistory: [],
      lastUpdatedAt: now,
    });
    const loaded = await politicalRepo.findByChatId(1);
    expect(loaded?.positions[0]?.topic).toBe('taxes');
    expect(loaded?.uncertaintyAreas).toEqual(['trade']);
  });

  it('round-trips a user social profile', async () => {
    const now = '2026-05-29T00:00:00.000Z';
    await profileRepo.upsert({
      userId: 10,
      chatId: 1,
      username: 'alice',
      affinityScore: -2,
      labels: [{ text: 'toxic', evidenceMessageIds: [3], status: 'active' }],
      patterns: [
        {
          polarity: 'negative',
          text: 'derails threads',
          evidenceMessageIds: [4],
          status: 'active',
        },
      ],
      grudges: [],
      trustLevel: 'low',
      preferredDistance: 'cold',
      communicationStyle: 'terse',
      conflictStyle: 'aggressive',
      preferredTone: 'blunt',
      interests: ['politics'],
      updatedAt: now,
    });
    const loaded = await profileRepo.findByChatAndUser(1, 10);
    expect(loaded?.affinityScore).toBe(-2);
    expect(loaded?.patterns[0]?.polarity).toBe('negative');
    expect((await profileRepo.findByChat(1)).length).toBe(1);
  });

  it('adds and reads truths, including contradictory ones', async () => {
    const now = '2026-05-29T00:00:00.000Z';
    const id1 = await truthRepo.add({
      chatId: 1,
      text: 'pizza is best',
      sourceMessageIds: [1],
      confidence: 0.7,
      relatedTruthIds: [],
      contradictsTruthIds: [],
      status: 'fresh',
      createdAt: now,
    });
    const id2 = await truthRepo.add({
      chatId: 1,
      text: 'sushi is best',
      sourceMessageIds: [2],
      confidence: 0.7,
      relatedTruthIds: [],
      contradictsTruthIds: [id1],
      status: 'fresh',
      createdAt: now,
    });
    expect(id2).toBeGreaterThan(id1);
    const all = await truthRepo.findByChatId(1);
    expect(all.length).toBe(2);

    const t2 = await truthRepo.findById(id2);
    expect(t2).toBeTruthy();
    if (t2) {
      t2.status = 'stable';
      await truthRepo.update(t2);
    }
    expect((await truthRepo.findById(id2))?.status).toBe('stable');
  });
});
