import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 025 scheduled_jobs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('creates scheduled_jobs with all columns and a unique slot constraint', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'scheduled-jobs-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const columns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(scheduled_jobs)'
    );

    await db.run(
      `INSERT INTO scheduled_jobs
        (job_name, slot_key, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at)
       VALUES ('fact-check', 'fact-check:2026-06-08T14', '{}', 'pending', 0, 5, ?, ?, ?)`,
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:00:00.000Z',
      '2026-06-08T14:00:00.000Z'
    );
    let duplicateRejected = false;
    try {
      await db.run(
        `INSERT INTO scheduled_jobs
          (job_name, slot_key, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at)
         VALUES ('fact-check', 'fact-check:2026-06-08T14', '{}', 'pending', 0, 5, ?, ?, ?)`,
        '2026-06-08T14:00:00.000Z',
        '2026-06-08T14:00:00.000Z',
        '2026-06-08T14:00:00.000Z'
      );
    } catch {
      duplicateRejected = true;
    }
    await db.close();

    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'job_name',
        'slot_key',
        'payload_json',
        'status',
        'attempts',
        'max_attempts',
        'run_after',
        'locked_until',
        'last_error',
        'created_at',
        'updated_at',
        'finished_at',
      ])
    );
    expect(duplicateRejected).toBe(true);
  });
});
