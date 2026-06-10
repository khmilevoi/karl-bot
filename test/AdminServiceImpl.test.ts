import { describe, expect, it, vi } from 'vitest';

import type {
  DbProvider,
  SqlDatabase,
} from '../src/domain/repositories/DbProvider';
import type { AccessKeyRepository } from '../src/domain/repositories/AccessKeyRepository';
import type { ChatUserService } from '../src/application/interfaces/chat/ChatUserService';
import type { MessageRepository } from '../src/domain/repositories/MessageRepository';
import type { SummaryRepository } from '../src/domain/repositories/SummaryRepository';
//
import { UserEntity } from '../src/domain/entities/UserEntity';
import { AdminServiceImpl } from '../src/application/use-cases/admin/AdminServiceImpl';
import type { ChatConfigService } from '../src/application/interfaces/chat/ChatConfigService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      child: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        child: vi.fn(),
      })),
    })),
  }) as unknown as LoggerFactory;

describe('AdminServiceImpl', () => {
  it('creates access key and returns expiry date', async () => {
    const accessRepo = {
      upsertKey: vi.fn(),
      deleteExpired: vi.fn(),
      findByChatAndUser: vi.fn(),
    } as unknown as AccessKeyRepository;
    const admin = new AdminServiceImpl(
      { get: vi.fn(), listTables: vi.fn() } as unknown as DbProvider,
      accessRepo,
      {} as unknown as MessageRepository,
      {} as unknown as SummaryRepository,
      {} as unknown as ChatUserService,
      {} as unknown as ChatConfigService,
      createLoggerFactory()
    );
    const expires = await admin.createAccessKey(1, 2, 1000);
    expect(accessRepo.upsertKey).toHaveBeenCalledWith({
      chatId: 1,
      userId: 2,
      accessKey: expect.any(String),
      expiresAt: expect.any(Number),
    });
    expect(expires).toBeInstanceOf(Date);
  });

  it('checks access by deleting expired keys and finding entry', async () => {
    const accessRepo = {
      deleteExpired: vi.fn(),
      findByChatAndUser: vi.fn(async () => ({ chatId: 1, userId: 2 })),
    } as unknown as AccessKeyRepository;
    const admin = new AdminServiceImpl(
      { get: vi.fn(), listTables: vi.fn() } as unknown as DbProvider,
      accessRepo,
      {} as unknown as MessageRepository,
      {} as unknown as SummaryRepository,
      {} as unknown as ChatUserService,
      {} as unknown as ChatConfigService,
      createLoggerFactory()
    );
    expect(await admin.hasAccess(1, 2)).toBe(true);
    expect(accessRepo.deleteExpired).toHaveBeenCalled();
    accessRepo.findByChatAndUser = vi.fn(async () => undefined);
    expect(await admin.hasAccess(1, 2)).toBe(false);
  });

  it('exports all database tables', async () => {
    const dbAll = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([]);
    const db = { all: dbAll } as unknown as SqlDatabase;
    const provider = {
      get: vi.fn(async () => db),
      listTables: vi.fn(async () => ['t']),
    } as unknown as DbProvider;
    const admin = new AdminServiceImpl(
      provider,
      {} as unknown as AccessKeyRepository,
      {} as unknown as MessageRepository,
      {} as unknown as SummaryRepository,
      {} as unknown as ChatUserService,
      {} as unknown as ChatConfigService,
      createLoggerFactory()
    );
    const files = await admin.exportTables();
    expect(files).toEqual([{ filename: 't.csv', buffer: expect.any(Buffer) }]);
    expect(dbAll).toHaveBeenCalled();
  });

  it('exports chat messages, summaries and users', async () => {
    const messageRepo = {
      findByChatId: vi.fn(async () => [
        {
          role: 'user',
          content: 'hi',
          username: 'u',
          fullName: 'F',
          replyText: '',
          replyUsername: '',
          quoteText: '',
          userId: 1,
          messageId: 1,
          chatId: 123,
        },
      ]),
    };
    const summaryRepo = { findById: vi.fn(async () => 's') };
    const chatUserService = {
      listUsers: vi.fn(async () => [new UserEntity(1, 'u', 'F', 'L')]),
    } as unknown as ChatUserService;
    const admin = new AdminServiceImpl(
      { get: vi.fn(), listTables: vi.fn() } as unknown as DbProvider,
      {} as unknown as AccessKeyRepository,
      messageRepo as unknown as MessageRepository,
      summaryRepo as unknown as SummaryRepository,
      chatUserService,
      {} as unknown as ChatConfigService,
      createLoggerFactory()
    );
    const files = await admin.exportChatData(123);
    expect(files.map((f) => f.filename).sort()).toEqual([
      'messages.csv',
      'summaries.csv',
      'users.csv',
    ]);
    const users = files.find((f) => f.filename === 'users.csv');
    expect(users?.buffer.toString()).toContain(
      'id,username,firstName,lastName'
    );
    expect(users?.buffer.toString()).toContain('1');
  });
});
