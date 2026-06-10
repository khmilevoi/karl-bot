import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteUserPoliticalProfileRepository } from '../src/infrastructure/persistence/sqlite/SQLiteUserPoliticalProfileRepository';
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

let repo: SQLiteUserPoliticalProfileRepository;
let provider: SQLiteDbProviderImpl;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'user-political-'));
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
  await db.run('INSERT INTO users (id, username) VALUES (10, ?)', 'alice');
  await db.run('INSERT INTO users (id, username) VALUES (20, ?)', 'bob');
  await db.close();

  provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
  repo = new SQLiteUserPoliticalProfileRepository(provider);
});

const now = '2026-05-31T00:00:00.000Z';
const neutralCompass = {
  economic: 0,
  social: 0,
  economicConfidence: 0,
  socialConfidence: 0,
};

describe('SQLiteUserPoliticalProfileRepository', () => {
  it('round-trips a profile with notes and compass', async () => {
    const profile = {
      chatId: 1,
      userId: 10,
      notes: [
        {
          text: 'supports free markets',
          evidenceMessageIds: [5, 6],
          status: 'active' as const,
        },
      ],
      compass: {
        economic: 4,
        social: -2,
        economicConfidence: 0.7,
        socialConfidence: 0.3,
      },
      updatedAt: now,
    };
    await repo.upsert(profile);
    const found = await repo.findByChatAndUser(1, 10);
    expect(found).toBeDefined();
    expect(found!.notes).toHaveLength(1);
    expect(found!.notes[0].text).toBe('supports free markets');
    expect(found!.notes[0].evidenceMessageIds).toEqual([5, 6]);
    expect(found!.compass.economic).toBe(4);
    expect(found!.compass.socialConfidence).toBe(0.3);
    expect(found!.updatedAt).toBe(now);
  });

  it('returns undefined when profile is missing', async () => {
    const result = await repo.findByChatAndUser(1, 10);
    expect(result).toBeUndefined();
  });

  it('findByChat returns all profiles for a chat', async () => {
    await repo.upsert({
      chatId: 1,
      userId: 10,
      notes: [],
      compass: neutralCompass,
      updatedAt: now,
    });
    await repo.upsert({
      chatId: 1,
      userId: 20,
      notes: [],
      compass: neutralCompass,
      updatedAt: now,
    });
    const profiles = await repo.findByChat(1);
    expect(profiles).toHaveLength(2);
  });

  it('upsert updates an existing profile', async () => {
    await repo.upsert({
      chatId: 1,
      userId: 10,
      notes: [],
      compass: neutralCompass,
      updatedAt: now,
    });
    const later = '2026-05-31T01:00:00.000Z';
    await repo.upsert({
      chatId: 1,
      userId: 10,
      notes: [{ text: 'new note', evidenceMessageIds: [], status: 'active' }],
      compass: {
        economic: 1,
        social: 1,
        economicConfidence: 0.5,
        socialConfidence: 0.5,
      },
      updatedAt: later,
    });
    const found = await repo.findByChatAndUser(1, 10);
    expect(found!.notes).toHaveLength(1);
    expect(found!.compass.economic).toBe(1);
    expect(found!.updatedAt).toBe(later);
  });

  it('throws when stored notes_json is malformed', async () => {
    const db = await provider.get();
    await db.run(
      `INSERT INTO user_political_profiles (chat_id, user_id, notes_json, compass_json, updated_at)
       VALUES (1, 10, 'not-json', '{"economic":0,"social":0,"economicConfidence":0,"socialConfidence":0}', ?)`,
      now
    );
    await expect(repo.findByChatAndUser(1, 10)).rejects.toThrow();
  });
});
