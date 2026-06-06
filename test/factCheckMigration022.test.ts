import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 022 fact checking', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('creates fact-check tables and adds chats.username', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'factcheck-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const tables = await db.all<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    );
    const chatColumns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(chats)'
    );
    await db.close();

    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'fact_check_windows',
        'fact_check_runs',
        'fact_check_findings',
        'fact_check_sources',
      ])
    );
    expect(chatColumns.map((c) => c.name)).toContain('username');
  });
});
