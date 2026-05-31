import { describe, expect, it, vi } from 'vitest';

import { RepositoryChatConfigService } from '../src/application/use-cases/chat/RepositoryChatConfigService';
import type { ChatConfigEntity } from '../src/domain/entities/ChatConfigEntity';
import type { ChatConfigRepository } from '../src/domain/repositories/ChatConfigRepository';

describe('RepositoryChatConfigService', () => {
  it('creates default config when missing', async () => {
    const repo: ChatConfigRepository = {
      findById: vi.fn(async () => undefined),
      upsert: vi.fn(async () => {}),
      findAll: vi.fn(async () => []),
    };
    const service = new RepositoryChatConfigService(repo);
    const config = await service.getConfig(1);
    expect(config).toEqual({
      chatId: 1,
      historyLimit: 50,
      topicTime: '09:00',
      topicTimezone: 'UTC',
    });
    expect(repo.upsert).toHaveBeenCalledWith(config);
  });

  it('sets history limit', async () => {
    const existing: ChatConfigEntity = {
      chatId: 1,
      historyLimit: 50,
      topicTime: '09:00',
      topicTimezone: 'UTC',
    };
    const repo: ChatConfigRepository = {
      findById: vi.fn(async () => existing),
      upsert: vi.fn(async () => {}),
      findAll: vi.fn(async () => []),
    };
    const service = new RepositoryChatConfigService(repo);
    await service.setHistoryLimit(1, 10);
    expect(repo.upsert).toHaveBeenCalledWith({ ...existing, historyLimit: 10 });
  });

  it('sets topic time', async () => {
    const existing: ChatConfigEntity = {
      chatId: 1,
      historyLimit: 50,
      topicTime: '09:00',
      topicTimezone: 'UTC',
    };
    const repo: ChatConfigRepository = {
      findById: vi.fn(async () => existing),
      upsert: vi.fn(async () => {}),
      findAll: vi.fn(async () => []),
    };
    const service = new RepositoryChatConfigService(repo);
    await service.setTopicTime(1, '10:30', 'Europe/Moscow');
    expect(repo.upsert).toHaveBeenCalledWith({
      ...existing,
      topicTime: '10:30',
      topicTimezone: 'Europe/Moscow',
    });
  });

  it('clears topic time when null', async () => {
    const existing: ChatConfigEntity = {
      chatId: 1,
      historyLimit: 50,
      topicTime: '09:00',
      topicTimezone: 'UTC',
    };
    const repo: ChatConfigRepository = {
      findById: vi.fn(async () => existing),
      upsert: vi.fn(async () => {}),
      findAll: vi.fn(async () => []),
    };
    const service = new RepositoryChatConfigService(repo);
    await service.setTopicTime(1, null, 'UTC');
    expect(repo.upsert).toHaveBeenCalledWith({
      ...existing,
      topicTime: null,
      topicTimezone: 'UTC',
    });
  });

  it('returns topic of day schedules', async () => {
    const repo: ChatConfigRepository = {
      findById: vi.fn(),
      upsert: vi.fn(),
      findAll: vi.fn(async () => [
        {
          chatId: 1,
          historyLimit: 50,
          topicTime: '10:30',
          topicTimezone: 'UTC',
        },
        {
          chatId: 2,
          historyLimit: 50,
          topicTime: null,
          topicTimezone: 'UTC',
        },
      ]),
    } as unknown as ChatConfigRepository;
    const service = new RepositoryChatConfigService(repo);
    const schedules = await service.getTopicOfDaySchedules();
    expect(schedules).toEqual(
      new Map([[1, { cron: '0 30 10 * * *', timezone: 'UTC' }]])
    );
  });
});
