import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof open>>;

let db: Db;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mig018-'));
  db = await open({
    filename: path.join(dir, 't.db'),
    driver: sqlite3.Database,
  });
  await db.exec(
    'CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, title TEXT);'
  );
  const up015 = readFileSync(
    path.join('migrations', '015_create_behavior_tables.up.sql'),
    'utf8'
  );
  await db.exec(up015);
});

describe('migration 018 (truth embedding column)', () => {
  it('adds embedding_json to bot_truths', async () => {
    const up = readFileSync(
      path.join('migrations', '018_add_truth_embedding.up.sql'),
      'utf8'
    );
    await db.exec(up);

    const cols = await db.all<{ name: string }[]>(
      "SELECT name FROM pragma_table_info('bot_truths')"
    );
    expect(cols.map((c) => c.name)).toContain('embedding_json');
  });

  it('down migration removes embedding_json again', async () => {
    const up = readFileSync(
      path.join('migrations', '018_add_truth_embedding.up.sql'),
      'utf8'
    );
    const down = readFileSync(
      path.join('migrations', '018_add_truth_embedding.down.sql'),
      'utf8'
    );
    await db.exec(up);
    await db.exec(down);

    const cols = await db.all<{ name: string }[]>(
      "SELECT name FROM pragma_table_info('bot_truths')"
    );
    expect(cols.map((c) => c.name)).not.toContain('embedding_json');
  });
});
