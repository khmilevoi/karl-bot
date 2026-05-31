import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof open>>;

let db: Db;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mig016-'));
  db = await open({
    filename: path.join(dir, 't.db'),
    driver: sqlite3.Database,
  });
  // Prerequisite operational tables for FK targets.
  await db.exec(`
    CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
  `);
  // Apply migration 015 first since 016 depends on bot_political_states.
  const up015 = readFileSync(
    path.join('migrations', '015_create_behavior_tables.up.sql'),
    'utf8'
  );
  await db.exec(up015);
});

describe('migration 016 (state evolution tables)', () => {
  it('creates the three new tables and political compass column', async () => {
    const up = readFileSync(
      path.join('migrations', '016_state_evolution.up.sql'),
      'utf8'
    );
    await db.exec(up);

    const botPersonalitySignalColumns = await db.all<Array<{ name: string }>>(
      'PRAGMA table_info(bot_personality_signals)'
    );
    expect(botPersonalitySignalColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'id',
        'chat_id',
        'area',
        'polarity',
        'text',
        'evidence_message_ids_json',
        'status',
        'created_at',
      ])
    );

    const botPersonalitySignalsChatIndex = await db.all<
      Array<{ name: string }>
    >(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_bot_personality_signals_chat'"
    );
    expect(botPersonalitySignalsChatIndex).toHaveLength(1);

    const rows = await db.all<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    const names = rows.map((r) => r.name);
    for (const t of [
      'bot_personality_signals',
      'state_evolution_cursors',
      'user_political_profiles',
    ]) {
      expect(names).toContain(t);
    }

    const cols = await db.all<{ name: string }[]>(
      'PRAGMA table_info(bot_political_states)'
    );
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('compass_json');

    const sigCols = await db.all<{ name: string }[]>(
      'PRAGMA table_info(bot_personality_signals)'
    );
    const sigColNames = sigCols.map((c) => c.name);
    for (const col of [
      'id',
      'chat_id',
      'area',
      'polarity',
      'text',
      'evidence_message_ids_json',
      'status',
      'created_at',
    ]) {
      expect(sigColNames).toContain(col);
    }

    const idxRows = await db.all<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_bot_personality_signals_chat'"
    );
    expect(idxRows.length).toBe(1);
  });

  it('down migration removes the 016 additions and leaves 015 tables intact', async () => {
    const up = readFileSync(
      path.join('migrations', '016_state_evolution.up.sql'),
      'utf8'
    );
    const down = readFileSync(
      path.join('migrations', '016_state_evolution.down.sql'),
      'utf8'
    );
    await db.exec(up);
    await db.exec(down);

    const signalChatIndexRowsAfterDown = await db.all<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_bot_personality_signals_chat'"
    );
    expect(signalChatIndexRowsAfterDown).toHaveLength(0);

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
    expect(names).not.toContain('bot_personality_signals');
    expect(names).not.toContain('state_evolution_cursors');
    expect(names).not.toContain('user_political_profiles');

    const cols = await db.all<{ name: string }[]>(
      'PRAGMA table_info(bot_political_states)'
    );
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('compass_json');

    const idxRows = await db.all<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_bot_personality_signals_chat'"
    );
    expect(idxRows.length).toBe(0);
  });
});
