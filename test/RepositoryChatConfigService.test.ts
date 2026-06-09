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
    });
    expect(repo.upsert).toHaveBeenCalledWith(config);
  });

  it('sets history limit', async () => {
    const existing: ChatConfigEntity = {
      chatId: 1,
      historyLimit: 50,
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
});
