import { inject, injectable } from 'inversify';

import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { ScheduledJobRepository } from '@/domain/repositories/ScheduledJobRepository';
import type {
  DueSlot,
  ScheduledJob,
  ScheduledJobName,
  ScheduledJobStatus,
} from '@/domain/scheduler/ScheduledJobTypes';

interface ScheduledJobRow {
  id: number;
  job_name: ScheduledJobName;
  slot_key: string;
  payload_json: string;
  status: ScheduledJobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

const DUE_PREDICATE = `(
  (status = 'pending' AND run_after <= ?)
  OR (status = 'retry_scheduled' AND run_after <= ?)
  OR (status = 'running' AND locked_until IS NOT NULL AND locked_until <= ?)
)`;

function rowToJob(row: ScheduledJobRow): ScheduledJob {
  return {
    id: row.id,
    jobName: row.job_name,
    slotKey: row.slot_key,
    payloadJson: row.payload_json,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lockedUntil: row.locked_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

@injectable()
export class SQLiteScheduledJobRepository implements ScheduledJobRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async insertDueSlot(
    slot: DueSlot,
    maxAttempts: number,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT OR IGNORE INTO scheduled_jobs
        (job_name, slot_key, payload_json, status, attempts, max_attempts, run_after, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
      slot.jobName,
      slot.slotKey,
      slot.payloadJson,
      maxAttempts,
      slot.runAfter,
      now,
      now
    );
  }

  async claimNext(
    now: string,
    lockedUntil: string
  ): Promise<ScheduledJob | null> {
    const db = await this.dbProvider.get();

    await db.run('BEGIN IMMEDIATE');
    try {
      const row = await db.get<ScheduledJobRow>(
        `SELECT * FROM scheduled_jobs
         WHERE ${DUE_PREDICATE}
         ORDER BY run_after ASC, id ASC
         LIMIT 1`,
        now,
        now,
        now
      );

      if (!row) {
        await db.run('COMMIT');
        return null;
      }

      const result = (await db.run(
        `UPDATE scheduled_jobs
         SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = ?
         WHERE id = ? AND ${DUE_PREDICATE}`,
        lockedUntil,
        now,
        row.id,
        now,
        now,
        now
      )) as { changes?: number };

      await db.run('COMMIT');

      if (result.changes !== 1) {
        return null;
      }

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

  async markSucceeded(id: number, now: string): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE scheduled_jobs
       SET status = 'succeeded', finished_at = ?, locked_until = NULL, last_error = NULL, updated_at = ?
       WHERE id = ?`,
      now,
      now,
      id
    );
  }

  async scheduleRetry(
    id: number,
    runAfter: string,
    lastError: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE scheduled_jobs
       SET status = 'retry_scheduled', run_after = ?, locked_until = NULL, last_error = ?, updated_at = ?
       WHERE id = ?`,
      runAfter,
      lastError,
      now,
      id
    );
  }

  async markFailed(id: number, lastError: string, now: string): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE scheduled_jobs
       SET status = 'failed', finished_at = ?, locked_until = NULL, last_error = ?, updated_at = ?
       WHERE id = ?`,
      now,
      lastError,
      now,
      id
    );
  }

  async findBySlot(
    jobName: ScheduledJobName,
    slotKey: string
  ): Promise<ScheduledJob | null> {
    const db = await this.dbProvider.get();
    const row = await db.get<ScheduledJobRow>(
      'SELECT * FROM scheduled_jobs WHERE job_name = ? AND slot_key = ?',
      jobName,
      slotKey
    );
    return row ? rowToJob(row) : null;
  }
}
