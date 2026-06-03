import { inject, injectable } from 'inversify';

import { ChatEntity } from '@/domain/entities/ChatEntity';
import { UserEntity } from '@/domain/entities/UserEntity';
import type { StoredMessage } from '@/domain/messages/StoredMessage';
import {
  CHAT_REPOSITORY_ID,
  type ChatRepository,
} from '@/domain/repositories/ChatRepository';
import {
  CHAT_USER_REPOSITORY_ID,
  type ChatUserRepository,
} from '@/domain/repositories/ChatUserRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import {
  USER_REPOSITORY_ID,
  type UserRepository,
} from '@/domain/repositories/UserRepository';
import type { VoiceTranscriptionJobRepository } from '@/domain/repositories/VoiceTranscriptionJobRepository';
import type {
  NewVoiceTranscriptionJob,
  VoiceTranscriptionJob,
  VoiceTranscriptionJobStatus,
} from '@/domain/voice/VoiceTypes';

interface VoiceJobRow {
  id: number;
  message_id: number;
  chat_id: number;
  telegram_message_id: number;
  telegram_file_id: string;
  status: VoiceTranscriptionJobStatus;
  attempts: number;
  available_at: string;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToJob(row: VoiceJobRow): VoiceTranscriptionJob {
  return {
    id: row.id,
    messageId: row.message_id,
    chatId: row.chat_id,
    telegramMessageId: row.telegram_message_id,
    telegramFileId: row.telegram_file_id,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    lockedUntil: row.locked_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SQLiteVoiceTranscriptionJobRepository implements VoiceTranscriptionJobRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider,
    @inject(CHAT_REPOSITORY_ID) private readonly chatRepo: ChatRepository,
    @inject(USER_REPOSITORY_ID) private readonly userRepo: UserRepository,
    @inject(CHAT_USER_REPOSITORY_ID)
    private readonly chatUserRepo: ChatUserRepository
  ) {}

  async createPendingMessageAndJob(
    message: StoredMessage,
    job: NewVoiceTranscriptionJob
  ): Promise<VoiceTranscriptionJob> {
    // Validate userId before doing any DB work — a missing userId would cause
    // a FK violation inside the transaction and leave the DB in a partial state.
    const userId = message.userId;
    if (!userId) throw new Error('userId is required for voice message creation');

    await this.chatRepo.upsert(
      new ChatEntity(message.chatId, message.chatTitle ?? null)
    );
    await this.userRepo.upsert(
      new UserEntity(
        userId,
        message.username ?? null,
        message.firstName ?? null,
        message.lastName ?? null
      )
    );
    await this.chatUserRepo.link(message.chatId, userId);

    const db = await this.dbProvider.get();
    // Capture now before the transaction so both inserts share the same timestamp.
    const now = new Date().toISOString();

    // The transaction ensures message + job are created atomically: if either
    // insert fails the entire operation is rolled back and nothing is persisted.
    await db.run('BEGIN IMMEDIATE');
    try {
      const msgResult = (await db.run(
        `INSERT INTO messages
          (chat_id, message_id, role, content, user_id, source_type, processing_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        message.chatId,
        message.messageId ?? null,
        message.role,
        message.content,
        userId,
        message.sourceType ?? 'voice',
        message.processingStatus ?? 'pending'
      )) as { lastID?: number };

      const msgLastId = msgResult.lastID;
      if (!msgLastId) throw new Error('Failed to insert voice message: no lastID');

      const jobResult = (await db.run(
        `INSERT INTO voice_transcription_jobs
          (message_id, chat_id, telegram_message_id, telegram_file_id, status, attempts, available_at, locked_until, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?)`,
        msgLastId,
        job.chatId,
        job.telegramMessageId,
        job.telegramFileId,
        job.availableAt,
        now,
        now
      )) as { lastID?: number };

      const jobLastId = jobResult.lastID;
      if (!jobLastId) throw new Error('Failed to insert voice job: no lastID');

      await db.run('COMMIT');

      // Construct the return value from known values — no post-COMMIT SELECT needed.
      return {
        id: jobLastId,
        messageId: msgLastId,
        chatId: job.chatId,
        telegramMessageId: job.telegramMessageId,
        telegramFileId: job.telegramFileId,
        status: 'queued' as const,
        attempts: 0,
        availableAt: job.availableAt,
        lockedUntil: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }

  async claimNext(
    now: string,
    lockedUntil: string
  ): Promise<VoiceTranscriptionJob | null> {
    const db = await this.dbProvider.get();

    await db.run('BEGIN IMMEDIATE');
    try {
      const row = await db.get<VoiceJobRow>(
        `SELECT * FROM voice_transcription_jobs
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
        `UPDATE voice_transcription_jobs
         SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = ?
         WHERE id = ?`,
        lockedUntil,
        now,
        row.id
      );

      await db.run('COMMIT');

      // Construct the return value from the pre-UPDATE snapshot + known mutations —
      // no post-COMMIT SELECT needed.
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

  async markDone(jobId: number, now: string): Promise<void> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `UPDATE voice_transcription_jobs
       SET status = 'done', locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      now,
      jobId
    )) as { changes?: number };
    if (!result.changes) throw new Error(`Voice job ${jobId} not found or already in terminal state`);
  }

  async requeue(
    jobId: number,
    availableAt: string,
    lastError: string | null,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `UPDATE voice_transcription_jobs
       SET status = 'queued', available_at = ?, last_error = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      availableAt,
      lastError,
      now,
      jobId
    )) as { changes?: number };
    if (!result.changes) throw new Error(`Voice job ${jobId} not found or already in terminal state`);
  }

  async markFailed(
    jobId: number,
    lastError: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `UPDATE voice_transcription_jobs
       SET status = 'failed', last_error = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      lastError,
      now,
      jobId
    )) as { changes?: number };
    if (!result.changes) throw new Error(`Voice job ${jobId} not found or already in terminal state`);
  }

  async markCancelled(
    jobId: number,
    reason: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `UPDATE voice_transcription_jobs
       SET status = 'cancelled', last_error = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      reason,
      now,
      jobId
    )) as { changes?: number };
    if (!result.changes) throw new Error(`Voice job ${jobId} not found or already in terminal state`);
  }
}
