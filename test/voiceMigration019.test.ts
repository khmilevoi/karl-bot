import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 019 voice messages and jobs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('adds message metadata and voice job table', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'voice-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const messageColumns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(messages)'
    );
    const voiceColumns = await db.all<{ name: string }[]>(
      'PRAGMA table_info(voice_transcription_jobs)'
    );
    await db.close();

    expect(messageColumns.map((c) => c.name)).toContain('source_type');
    expect(messageColumns.map((c) => c.name)).toContain('processing_status');
    expect(voiceColumns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'message_id',
        'chat_id',
        'telegram_message_id',
        'telegram_file_id',
        'status',
        'attempts',
        'available_at',
        'locked_until',
        'last_error',
        'created_at',
        'updated_at',
      ])
    );
  });
});
