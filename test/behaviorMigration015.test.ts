import { readFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof open>>;

let db: Db;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mig015-'));
  db = await open({
    filename: path.join(dir, 't.db'),
    driver: sqlite3.Database,
  });
  // Prerequisite operational tables for FK targets.
  await db.exec(`
    CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
  `);
});

describe('migration 015 (behavior tables)', () => {
  it('creates the six new tables', async () => {
    const up = readFileSync(
      path.join('migrations', '015_create_behavior_tables.up.sql'),
      'utf8'
    );
    await db.exec(up);

    const rows = await db.all<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const names = rows.map((r) => r.name);
    for (const t of [
      'bot_personality_states',
      'bot_political_states',
      'bot_truths',
      'user_social_profiles',
      'behavior_events',
      'ai_error_events',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('down migration drops the six tables and leaves operational tables intact', async () => {
    const up = readFileSync(
      path.join('migrations', '015_create_behavior_tables.up.sql'),
      'utf8'
    );
    const down = readFileSync(
      path.join('migrations', '015_create_behavior_tables.down.sql'),
      'utf8'
    );
    await db.exec(up);
    await db.exec(down);

    const rows = await db.all<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain('chats');
    expect(names).toContain('users');
    expect(names).not.toContain('behavior_events');
    expect(names).not.toContain('bot_truths');
  });
});
