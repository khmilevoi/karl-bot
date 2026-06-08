import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 023 fact-check notification intent', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('adds should_notify_immediately to fact_check_findings', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'factcheck-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const info = await db.all<{ name: string }[]>(
      'PRAGMA table_info(fact_check_findings)'
    );
    await db.close();

    expect(info.map((c) => c.name)).toContain('should_notify_immediately');
  });
});
