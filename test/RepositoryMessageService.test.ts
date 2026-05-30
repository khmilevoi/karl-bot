import { describe, expect, it, vi } from 'vitest';

import { type ChatRepository } from '../src/domain/repositories/ChatRepository';
import { type ChatUserRepository } from '../src/domain/repositories/ChatUserRepository';
import { type MessageRepository } from '../src/domain/repositories/MessageRepository';
import { type UserRepository } from '../src/domain/repositories/UserRepository';
import { RepositoryMessageService } from '../src/application/use-cases/messages/RepositoryMessageService';
import { type StoredMessage } from '../src/domain/messages/StoredMessage';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

describe('RepositoryMessageService', () => {
  it('links chat and user when adding a message', async () => {
    const chatRepo: ChatRepository = {
      upsert: vi.fn(),
    } as unknown as ChatRepository;
    const userRepo: UserRepository = {
      upsert: vi.fn(),
    } as unknown as UserRepository;
    const messageRepo: MessageRepository = {
      insert: vi.fn().mockResolvedValue(1),
    } as unknown as MessageRepository;
    const chatUserRepo: ChatUserRepository = {
      link: vi.fn(),
    } as unknown as ChatUserRepository;

    const loggerFactory: LoggerFactory = {
      create: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    } as unknown as LoggerFactory;

    const service = new RepositoryMessageService(
      chatRepo,
      userRepo,
      messageRepo,
      chatUserRepo,
      loggerFactory
    );

    const message: StoredMessage = {
      chatId: 123,
      role: 'user',
      content: 'hello',
      userId: 456,
    };

    await service.addMessage(message);

    expect(chatUserRepo.link).toHaveBeenCalledWith(123, 456);
  });

  it('fetches messages, counts, retrieves last and clears', async () => {
    const messageRepo: MessageRepository = {
      findByChatId: vi.fn().mockResolvedValue([]),
      countByChatId: vi.fn().mockResolvedValue(0),
      findLastByChatId: vi.fn().mockResolvedValue([]),
      clearByChatId: vi.fn(),
    } as unknown as MessageRepository;

    const service = new RepositoryMessageService(
      {} as unknown as ChatRepository,
      {} as unknown as UserRepository,
      messageRepo,
      {} as unknown as ChatUserRepository,
      {
        create: () => ({
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          child: vi.fn(),
        }),
      } as unknown as LoggerFactory
    );

    await service.getMessages(1);
    await service.getCount(2);
    await service.getLastMessages(3, 4);
    await service.clearMessages(5);

    expect(messageRepo.findByChatId).toHaveBeenCalledWith(1);
    expect(messageRepo.countByChatId).toHaveBeenCalledWith(2);
    expect(messageRepo.findLastByChatId).toHaveBeenCalledWith(3, 4);
    expect(messageRepo.clearByChatId).toHaveBeenCalledWith(5);
  });
});
