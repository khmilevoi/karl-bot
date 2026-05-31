import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof open>>;

let db: Db;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mig017-'));
  db = await open({
    filename: path.join(dir, 't.db'),
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      attitude TEXT
    );
    INSERT INTO users (id, username, first_name, last_name, attitude)
    VALUES (1, 'alice', 'Alice', 'A', 'friendly');

    CREATE TABLE chats (
      chat_id INTEGER PRIMARY KEY,
      title TEXT
    );
    INSERT INTO chats (chat_id, title) VALUES (10, 'Chat');

    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      message_id INTEGER,
      role TEXT,
      content TEXT,
      user_id INTEGER NOT NULL,
      reply_text TEXT,
      reply_username TEXT,
      quote_text TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(chat_id) REFERENCES chats(chat_id)
    );
    INSERT INTO messages (chat_id, message_id, role, content, user_id)
    VALUES (10, 100, 'user', 'hello', 1);

    CREATE TABLE chat_configs (
      chat_id INTEGER PRIMARY KEY,
      history_limit INTEGER NOT NULL DEFAULT 50,
      interest_interval INTEGER NOT NULL DEFAULT 25,
      topic_time TEXT,
      topic_timezone TEXT
    );
    INSERT INTO chat_configs (
      chat_id,
      history_limit,
      interest_interval,
      topic_time,
      topic_timezone
    )
    VALUES (10, 40, 12, '09:00', 'Europe/Warsaw');
  `);
});

describe('migration 017 (cutover legacy cleanup)', () => {
  it('adds message soft-delete and drops legacy user/config columns', async () => {
    const up = readFileSync(
      path.join('migrations', '017_cutover_legacy_cleanup.up.sql'),
      'utf8'
    );
    await db.exec(up);

    const userCols = await db.all<{ name: string }[]>(
      'PRAGMA table_info(users)'
    );
    expect(userCols.map((c) => c.name)).toEqual([
      'id',
      'username',
      'first_name',
      'last_name',
    ]);

    const row = await db.get<{
      id: number;
      username: string;
      first_name: string;
      last_name: string;
    }>('SELECT id, username, first_name, last_name FROM users WHERE id = 1');
    expect(row).toEqual({
      id: 1,
      username: 'alice',
      first_name: 'Alice',
      last_name: 'A',
    });

    const messageCols = await db.all<{ name: string; dflt_value: string }[]>(
      'PRAGMA table_info(messages)'
    );
    expect(messageCols.map((c) => c.name)).toContain('is_active');
    const activeCol = messageCols.find((c) => c.name === 'is_active');
    expect(activeCol?.dflt_value).toBe('1');

    const messageRow = await db.get<{ is_active: number }>(
      'SELECT is_active FROM messages WHERE id = 1'
    );
    expect(messageRow).toEqual({ is_active: 1 });

    const configCols = await db.all<{ name: string }[]>(
      'PRAGMA table_info(chat_configs)'
    );
    expect(configCols.map((c) => c.name)).toEqual([
      'chat_id',
      'history_limit',
      'topic_time',
      'topic_timezone',
    ]);

    const configRow = await db.get<{
      chat_id: number;
      history_limit: number;
      topic_time: string;
      topic_timezone: string;
    }>(
      'SELECT chat_id, history_limit, topic_time, topic_timezone FROM chat_configs WHERE chat_id = 10'
    );
    expect(configRow).toEqual({
      chat_id: 10,
      history_limit: 40,
      topic_time: '09:00',
      topic_timezone: 'Europe/Warsaw',
    });
  });

  it('down migration restores legacy columns and removes message soft-delete', async () => {
    const up = readFileSync(
      path.join('migrations', '017_cutover_legacy_cleanup.up.sql'),
      'utf8'
    );
    const down = readFileSync(
      path.join('migrations', '017_cutover_legacy_cleanup.down.sql'),
      'utf8'
    );
    await db.exec(up);
    await db.exec(down);

    const userCols = await db.all<{ name: string }[]>(
      'PRAGMA table_info(users)'
    );
    expect(userCols.map((c) => c.name)).toContain('attitude');

    const row = await db.get<{ attitude: string | null }>(
      'SELECT attitude FROM users WHERE id = 1'
    );
    expect(row).toEqual({ attitude: null });

    const configCols = await db.all<{ name: string }[]>(
      'PRAGMA table_info(chat_configs)'
    );
    expect(configCols.map((c) => c.name)).toContain('interest_interval');
    const configRow = await db.get<{ interest_interval: number }>(
      'SELECT interest_interval FROM chat_configs WHERE chat_id = 10'
    );
    expect(configRow).toEqual({ interest_interval: 25 });

    const messageCols = await db.all<{ name: string }[]>(
      'PRAGMA table_info(messages)'
    );
    expect(messageCols.map((c) => c.name)).not.toContain('is_active');
  });
});
