import { randomBytes } from 'node:crypto';

import { inject, injectable } from 'inversify';

import type { AdminService } from '@/application/interfaces/admin/AdminService';
import {
  CHAT_CONFIG_SERVICE_ID,
  type ChatConfigService,
} from '@/application/interfaces/chat/ChatConfigService';
import {
  CHAT_USER_SERVICE_ID,
  type ChatUserService,
} from '@/application/interfaces/chat/ChatUserService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type { UserEntity } from '@/domain/entities/UserEntity';
import type { ChatMessage } from '@/domain/messages/ChatMessage';
import {
  ACCESS_KEY_REPOSITORY_ID,
  type AccessKeyRepository,
} from '@/domain/repositories/AccessKeyRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
  type SqlDatabase,
} from '@/domain/repositories/DbProvider';
import {
  MESSAGE_REPOSITORY_ID,
  type MessageRepository,
} from '@/domain/repositories/MessageRepository';
import {
  SUMMARY_REPOSITORY_ID,
  type SummaryRepository,
} from '@/domain/repositories/SummaryRepository';
//

@injectable()
export class AdminServiceImpl implements AdminService {
  private readonly logger: Logger;

  constructor(
    @inject(DB_PROVIDER_ID) private dbProvider: DbProvider,
    @inject(ACCESS_KEY_REPOSITORY_ID)
    private accessKeyRepo: AccessKeyRepository,
    @inject(MESSAGE_REPOSITORY_ID) private messageRepo: MessageRepository,
    @inject(SUMMARY_REPOSITORY_ID) private summaryRepo: SummaryRepository,
    @inject(CHAT_USER_SERVICE_ID) private chatUsers: ChatUserService,
    @inject(CHAT_CONFIG_SERVICE_ID) private chatConfig: ChatConfigService,
    @inject(LOGGER_FACTORY_ID) private loggerFactory: LoggerFactory
  ) {
    this.logger = this.loggerFactory.create('AdminServiceImpl');
  }

  async createAccessKey(
    chatId: number,
    userId: number,
    ttlMs = 24 * 60 * 60 * 1000
  ): Promise<Date> {
    const key = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + ttlMs;
    await this.accessKeyRepo.upsertKey({
      chatId,
      userId,
      accessKey: key,
      expiresAt,
    });
    this.logger.info({ chatId, userId, expiresAt }, 'Created access key');
    return new Date(expiresAt);
  }

  async hasAccess(chatId: number, userId: number): Promise<boolean> {
    this.logger.debug({ chatId, userId }, '[HAS_ACCESS] Checking user access');
    await this.accessKeyRepo.deleteExpired(Date.now());
    const entry = await this.accessKeyRepo.findByChatAndUser(chatId, userId);
    const hasAccess = entry !== undefined;
    this.logger.debug(
      { chatId, userId, hasAccess, entry },
      '[HAS_ACCESS] Access check result'
    );
    return hasAccess;
  }

  async exportTables(): Promise<{ filename: string; buffer: Buffer }[]> {
    const db = await this.dbProvider.get();
    const tableNames = await this.dbProvider.listTables();
    const files: { filename: string; buffer: Buffer }[] = [];
    for (const name of tableNames) {
      try {
        const buffer = await this.exportTable(db, name);
        if (buffer && buffer.length > 0) {
          files.push({ filename: `${name}.csv`, buffer });
        }
      } catch (error) {
        this.logger.error({ table: name, error }, 'Failed to export table');
      }
    }
    this.logger.info({ count: files.length }, 'Exported tables');
    return files;
  }

  async exportChatData(
    chatId: number
  ): Promise<{ filename: string; buffer: Buffer }[]> {
    const files: { filename: string; buffer: Buffer }[] = [];

    const messages = await this.messageRepo.findByChatId(chatId);
    if (messages.length > 0) {
      const header: (keyof ChatMessage)[] = [
        'role',
        'content',
        'username',
        'fullName',
        'replyText',
        'replyUsername',
        'quoteText',
        'userId',
        'messageId',
        'chatId',
      ];
      const lines = messages.map((m) =>
        header.map((h) => JSON.stringify(m[h] ?? '')).join(',')
      );
      const csv = header.join(',') + '\n' + lines.join('\n');
      files.push({ filename: 'messages.csv', buffer: Buffer.from(csv) });
    }

    const summary = await this.summaryRepo.findById(chatId);
    if (summary) {
      const csv = 'chat_id,summary\n' + `${chatId},${JSON.stringify(summary)}`;
      files.push({ filename: 'summaries.csv', buffer: Buffer.from(csv) });
    }

    const existing = await this.chatUsers.listUsers(chatId);
    if (existing.length > 0) {
      const header: (keyof UserEntity)[] = [
        'id',
        'username',
        'firstName',
        'lastName',
      ];
      const lines = existing.map((u) =>
        header.map((h) => JSON.stringify(u[h] ?? '')).join(',')
      );
      const csv = header.join(',') + '\n' + lines.join('\n');
      files.push({ filename: 'users.csv', buffer: Buffer.from(csv) });
    }
    this.logger.info({ chatId, count: files.length }, 'Exported chat data');
    return files;
  }

  async setHistoryLimit(chatId: number, value: number): Promise<void> {
    await this.chatConfig.setHistoryLimit(chatId, value);
    this.logger.info({ chatId, value }, 'Updated history limit');
  }

  private async exportTable(
    db: SqlDatabase,
    table: string
  ): Promise<Buffer | null> {
    try {
      const chunkSize = 100;
      let offset = 0;
      let header: string | undefined;
      const lines: string[] = [];
      while (true) {
        const rows: Record<string, unknown>[] = await db.all(
          `SELECT * FROM ${table} LIMIT ? OFFSET ?`,
          chunkSize,
          offset
        );
        if (rows.length === 0) break;
        header ??= Object.keys(rows[0]).join(',');
        for (const row of rows) {
          const line = Object.keys(row)
            .map((k) => JSON.stringify(row[k] ?? ''))
            .join(',');
          lines.push(line);
        }
        offset += rows.length;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (!header) {
        return null;
      }
      const csv = header + '\n' + lines.join('\n');
      return Buffer.from(csv);
    } catch (error) {
      this.logger.error({ table, error }, 'Failed to generate CSV');
      return null;
    }
  }
}
