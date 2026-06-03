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
    await this.chatRepo.upsert(
      new ChatEntity(message.chatId, message.chatTitle ?? null)
    );
    await this.userRepo.upsert(
      new UserEntity(
        message.userId ?? 0,
        message.username ?? null,
        message.firstName ?? null,
        message.lastName ?? null
      )
    );
    await this.chatUserRepo.link(message.chatId, message.userId ?? 0);

    const db = await this.dbProvider.get();
    const now = new Date().toISOString();

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
        message.userId ?? 0,
        message.sourceType ?? 'voice',
        message.processingStatus ?? 'pending'
      )) as { lastID?: number };

      const messageId = msgResult.lastID ?? 0;

      const jobResult = (await db.run(
        `INSERT INTO voice_transcription_jobs
          (message_id, chat_id, telegram_message_id, telegram_file_id, status, attempts, available_at, locked_until, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', 0, ?, NULL, NULL, ?, ?)`,
        messageId,
        job.chatId,
        job.telegramMessageId,
        job.telegramFileId,
        job.availableAt,
        now,
        now
      )) as { lastID?: number };

      await db.run('COMMIT');

      const row = await db.get<VoiceJobRow>(
        'SELECT * FROM voice_transcription_jobs WHERE id = ?',
        jobResult.lastID ?? 0
      );

      if (!row) {
        throw new Error('Failed to retrieve newly created voice job');
      }

      return rowToJob(row);
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

      const updated = await db.get<VoiceJobRow>(
        'SELECT * FROM voice_transcription_jobs WHERE id = ?',
        row.id
      );

      if (!updated) {
        return null;
      }

      return rowToJob(updated);
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }

  async markDone(jobId: number, now: string): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE voice_transcription_jobs
       SET status = 'done', locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      now,
      jobId
    );
  }

  async requeue(
    jobId: number,
    availableAt: string,
    lastError: string | null,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE voice_transcription_jobs
       SET status = 'queued', available_at = ?, last_error = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      availableAt,
      lastError,
      now,
      jobId
    );
  }

  async markFailed(
    jobId: number,
    lastError: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE voice_transcription_jobs
       SET status = 'failed', last_error = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      lastError,
      now,
      jobId
    );
  }

  async markCancelled(
    jobId: number,
    reason: string,
    now: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE voice_transcription_jobs
       SET status = 'cancelled', last_error = ?, locked_until = NULL, updated_at = ?
       WHERE id = ?`,
      reason,
      now,
      jobId
    );
  }
}
