import { inject, injectable } from 'inversify';

import { type ChatConfigService } from '@/application/interfaces/chat/ChatConfigService';
import { InvalidHistoryLimitError } from '@/application/interfaces/chat/ChatConfigService.errors';
import type { ChatConfigEntity } from '@/domain/entities/ChatConfigEntity';
import {
  CHAT_CONFIG_REPOSITORY_ID,
  type ChatConfigRepository,
} from '@/domain/repositories/ChatConfigRepository';

const DEFAULT_HISTORY_LIMIT = 50;

@injectable()
export class RepositoryChatConfigService implements ChatConfigService {
  constructor(
    @inject(CHAT_CONFIG_REPOSITORY_ID) private repo: ChatConfigRepository
  ) {}

  async getConfig(chatId: number): Promise<ChatConfigEntity> {
    let config = await this.repo.findById(chatId);
    if (!config) {
      config = {
        chatId,
        historyLimit: DEFAULT_HISTORY_LIMIT,
      };
      await this.repo.upsert(config);
    }
    return config;
  }

  async setHistoryLimit(chatId: number, historyLimit: number): Promise<void> {
    if (
      !Number.isInteger(historyLimit) ||
      historyLimit <= 0 ||
      historyLimit > 50
    ) {
      throw new InvalidHistoryLimitError('Invalid history limit');
    }
    const config = await this.getConfig(chatId);
    await this.repo.upsert({ ...config, historyLimit });
  }
}
