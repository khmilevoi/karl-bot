import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 020 audio transcription jobs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('adds audio_transcription_jobs table with all required columns', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audio-job-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const columns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(audio_transcription_jobs)'
    );
    await db.close();

    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'telegram_file_id',
        'status',
        'attempts',
        'available_at',
        'locked_until',
        'result_text',
        'last_error',
        'created_at',
        'updated_at',
      ])
    );
  });
});
