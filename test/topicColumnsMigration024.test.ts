import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof open>>;

let db: Db;

const columnNames = async (): Promise<string[]> => {
  const cols = await db.all<{ name: string }[]>(
    'PRAGMA table_info(chat_configs)'
  );
  return cols.map((c) => c.name);
};

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mig024-'));
  db = await open({
    filename: path.join(dir, 't.db'),
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE chat_configs (
      chat_id INTEGER PRIMARY KEY,
      history_limit INTEGER NOT NULL DEFAULT 50,
      topic_time TEXT,
      topic_timezone TEXT NOT NULL DEFAULT 'UTC'
    );
    INSERT INTO chat_configs (
      chat_id,
      history_limit,
      topic_time,
      topic_timezone
    )
    VALUES (10, 40, '09:00', 'Europe/Warsaw');
  `);
});

describe('migration 024 drop topic-of-day columns', () => {
  it('drops topic columns and preserves chat config rows', async () => {
    const up = readFileSync(
      path.join('migrations', '024_drop_topic_of_day_columns.up.sql'),
      'utf8'
    );
    await db.exec(up);

    expect(await columnNames()).toEqual(['chat_id', 'history_limit']);
    const row = await db.get<{ chat_id: number; history_limit: number }>(
      'SELECT chat_id, history_limit FROM chat_configs WHERE chat_id = 10'
    );
    expect(row).toEqual({ chat_id: 10, history_limit: 40 });
  });

  it('down migration restores topic columns with defaults', async () => {
    const up = readFileSync(
      path.join('migrations', '024_drop_topic_of_day_columns.up.sql'),
      'utf8'
    );
    const down = readFileSync(
      path.join('migrations', '024_drop_topic_of_day_columns.down.sql'),
      'utf8'
    );
    await db.exec(up);
    await db.exec(down);

    expect(await columnNames()).toEqual([
      'chat_id',
      'history_limit',
      'topic_time',
      'topic_timezone',
    ]);
    const row = await db.get<{
      topic_time: string | null;
      topic_timezone: string;
    }>(
      'SELECT topic_time, topic_timezone FROM chat_configs WHERE chat_id = 10'
    );
    expect(row).toEqual({ topic_time: null, topic_timezone: 'UTC' });
  });
});
