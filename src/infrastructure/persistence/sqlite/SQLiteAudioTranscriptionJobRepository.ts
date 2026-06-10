import { inject, injectable } from 'inversify';

import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { AudioTranscriptionJobRepository } from '@/domain/repositories/AudioTranscriptionJobRepository';
import type {
  AudioTranscriptionJob,
  AudioTranscriptionJobStatus,
  NewAudioTranscriptionJob,
} from '@/domain/voice/AudioTranscriptionJobTypes';

interface AudioJobRow {
  id: number;
  telegram_file_id: string;
  status: AudioTranscriptionJobStatus;
  attempts: number;
  available_at: string;
  locked_until: string | null;
  result_text: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: AudioJobRow): AudioTranscriptionJob {
  return {
    id: row.id,
    telegramFileId: row.telegram_file_id,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    lockedUntil: row.locked_until,
    resultText: row.result_text,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SQLiteAudioTranscriptionJobRepository implements AudioTranscriptionJobRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async create(job: NewAudioTranscriptionJob): Promise<AudioTranscriptionJob> {
    const db = await this.dbProvider.get();
    const now = new Date().toISOString();

    const result = (await db.run(
      `INSERT INTO audio_transcription_jobs
        (telegram_file_id, status, attempts, available_at, locked_until, result_text, last_error, created_at, updated_at)
       VALUES (?, 'queued', 0, ?, NULL, NULL, NULL, ?, ?)`,
      job.telegramFileId,
      job.availableAt,
      now,
      now
    )) as { lastID?: number };

    const lastId = result.lastID;
    if (!lastId)
      throw new Error('Failed to insert audio transcription job: no lastID');

    return {
      id: lastId,
      telegramFileId: job.telegramFileId,
      status: 'queued',
      attempts: 0,
      availableAt: job.availableAt,
      lockedUntil: null,
      resultText: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async findById(jobId: number): Promise<AudioTranscriptionJob | null> {
    const db = await this.dbProvider.get();
    const row = await db.get<AudioJobRow>(
      'SELECT * FROM audio_transcription_jobs WHERE id = ?',
      jobId
    );
    return row ? rowToJob(row) : null;
  }

  async claimNext(
    now: string,
    lockedUntil: string
  ): Promise<AudioTranscriptionJob | null> {
    const db = await this.dbProvider.get();

    await db.run('BEGIN IMMEDIATE');
    try {
      const row = await db.get<AudioJobRow>(
        `SELECT * FROM audio_transcription_jobs
         WHERE
           (status = 'queued' AND available_at <= ?)
           OR (status = 'running' AND locked_until IS NOT NULL AND locked_until <= ?)
         ORDER BY available_at ASC, id ASC
         LIMIT 1`,
        now,
        now
      );

      if (!row) {
        await db.run('COMMIT');
        return null;
      }

      await db.run(
        `UPDATE audio_transcription_jobs
         SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = ?
         WHERE id = ?`,
        lockedUntil,
        now,
        row.id
      );

      await db.run('COMMIT');

      return rowToJob({
        ...row,
        status: 'running',
        attempts: row.attempts + 1,
        locked_until: lockedUntil,
        updated_at: now,
      });
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }

  async markDone(
    jobId: number,
    resultText: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `UPDATE audio_transcription_jobs
       SET status = 'done', result_text = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      resultText,
      now,
      jobId
    )) as { changes?: number };
    if (!result.changes)
      throw new Error(
        `Audio transcription job ${jobId} not found or already in terminal state`
      );
  }

  async requeue(
    jobId: number,
    availableAt: string,
    lastError: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `UPDATE audio_transcription_jobs
       SET status = 'queued', available_at = ?, last_error = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      availableAt,
      lastError,
      now,
      jobId
    )) as { changes?: number };
    if (!result.changes)
      throw new Error(
        `Audio transcription job ${jobId} not found or already in terminal state`
      );
  }

  async markFailed(
    jobId: number,
    lastError: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `UPDATE audio_transcription_jobs
       SET status = 'failed', last_error = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      lastError,
      now,
      jobId
    )) as { changes?: number };
    if (!result.changes)
      throw new Error(
        `Audio transcription job ${jobId} not found or already in terminal state`
      );
  }

  async markCancelled(
    jobId: number,
    reason: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `UPDATE audio_transcription_jobs
       SET status = 'cancelled', last_error = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      reason,
      now,
      jobId
    )) as { changes?: number };
    if (!result.changes)
      throw new Error(
        `Audio transcription job ${jobId} not found or already in terminal state`
      );
  }
}
