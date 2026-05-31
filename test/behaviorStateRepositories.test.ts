import { mkdtempSync, readFileSync, readdirSync } from 'fs';
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
let provider: SQLiteDbProviderImpl;

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
  const compassMigration =
    readdirSync('migrations').find((file) => /^016_.*\.up\.sql$/.test(file)) ??
    null;
  if (compassMigration == null) {
    throw new Error('Missing migration 016 for political compass');
  }
  await db.exec(
    readFileSync(path.join('migrations', compassMigration), 'utf8')
  );
  await db.run('INSERT INTO chats (chat_id) VALUES (1)');
  await db.run('INSERT INTO users (id, username) VALUES (10, ?)', 'alice');
  await db.close();

  provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
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
      compass: {
        economic: 3,
        social: -2,
        economicConfidence: 0.4,
        socialConfidence: 0.3,
      },
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
    expect(loaded?.compass).toEqual({
      economic: 3,
      social: -2,
      economicConfidence: 0.4,
      socialConfidence: 0.3,
    });
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

describe('behavior state repositories reject corrupt rows on read', () => {
  const now = '2026-05-29T00:00:00.000Z';

  it('rejects a profile whose stored affinity score is out of range', async () => {
    await profileRepo.upsert({
      userId: 10,
      chatId: 1,
      username: 'alice',
      affinityScore: 0,
      labels: [],
      patterns: [],
      grudges: [],
      trustLevel: 'low',
      preferredDistance: 'cold',
      communicationStyle: 'terse',
      conflictStyle: 'aggressive',
      preferredTone: 'blunt',
      interests: [],
      updatedAt: now,
    });
    const db = await provider.get();
    await db.run(
      'UPDATE user_social_profiles SET affinity_score = 99 WHERE chat_id = 1 AND user_id = 10'
    );
    await expect(profileRepo.findByChatAndUser(1, 10)).rejects.toThrow();
  });

  it('rejects a truth whose stored status is not a known enum value', async () => {
    const id = await truthRepo.add({
      chatId: 1,
      text: 'pizza is best',
      sourceMessageIds: [1],
      confidence: 0.7,
      relatedTruthIds: [],
      contradictsTruthIds: [],
      status: 'fresh',
      createdAt: now,
    });
    const db = await provider.get();
    await db.run('UPDATE bot_truths SET status = ? WHERE id = ?', 'bogus', id);
    await expect(truthRepo.findById(id)).rejects.toThrow();
  });

  it('rejects a personality state with an invalid nested speech style', async () => {
    await personalityRepo.upsert({
      chatId: 1,
      identityNotes: [],
      values: [],
      speechStyle: {
        tone: 'dry',
        humor: 'sarcastic',
        verbosity: 'short',
        formality: 'low',
      },
      socialHabits: [],
      recurringThemes: [],
      lastUpdatedAt: now,
    });
    const db = await provider.get();
    await db.run(
      'UPDATE bot_personality_states SET speech_style_json = ? WHERE chat_id = 1',
      '{"tone":"dry","humor":"sarcastic","verbosity":"loud","formality":"low"}'
    );
    await expect(personalityRepo.findByChatId(1)).rejects.toThrow();
  });

  it('rejects a political state with a malformed stored position', async () => {
    await politicalRepo.upsert({
      chatId: 1,
      ideologySummary: '',
      compass: {
        economic: 0,
        social: 0,
        economicConfidence: 0,
        socialConfidence: 0,
      },
      positions: [],
      uncertaintyAreas: [],
      influenceHistory: [],
      lastUpdatedAt: now,
    });
    const db = await provider.get();
    await db.run(
      'UPDATE bot_political_states SET positions_json = ? WHERE chat_id = 1',
      '[{}]'
    );
    await expect(politicalRepo.findByChatId(1)).rejects.toThrow();
  });
});
