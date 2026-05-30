import { inject, injectable } from 'inversify';

import {
  CHAT_CONFIG_SERVICE_ID,
  type ChatConfigService,
} from '@/application/interfaces/chat/ChatConfigService';
import type { ChatMemory as ChatMemoryInterface } from '@/application/interfaces/chat/ChatMemory';
import type { ChatMemoryManager as ChatMemoryManagerInterface } from '@/application/interfaces/chat/ChatMemoryManager';
import {
  CHAT_RESET_SERVICE_ID,
  type ChatResetService,
} from '@/application/interfaces/chat/ChatResetService';
import {
  HISTORY_SUMMARIZER_ID,
  type HistorySummarizer,
} from '@/application/interfaces/chat/HistorySummarizer';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  INTEREST_MESSAGE_STORE_ID,
  type InterestMessageStore,
} from '@/application/interfaces/messages/InterestMessageStore';
import {
  MESSAGE_SERVICE_ID,
  type MessageService,
} from '@/application/interfaces/messages/MessageService';
import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { StoredMessage } from '@/domain/messages/StoredMessage';

@injectable()
export class ChatMemory implements ChatMemoryInterface {
  private readonly logger: Logger;

  constructor(
    private messages: MessageService,
    private summarizer: HistorySummarizer,
    private localStore: InterestMessageStore,
    private chatId: number,
    private limit: number,
    private loggerFactory: LoggerFactory
  ) {
    this.logger = this.loggerFactory.create('ChatMemory');
  }

  public async addMessage(message: StoredMessage): Promise<number> {
    this.logger.debug(
      {
        chatId: this.chatId,
        role: message.role,
        limit: this.limit,
      },
      'Adding message'
    );
    const id = await this.messages.addMessage({
      ...message,
      chatId: this.chatId,
    });
    this.localStore.addMessage({ ...message, chatId: this.chatId });

    // Проверяем лимит после добавления сообщения
    const history = await this.messages.getMessages(this.chatId);
    this.logger.debug(
      {
        chatId: this.chatId,
        historyLength: history.length,
        limit: this.limit,
      },
      'Checking history limit after adding message'
    );
    const summarized = await this.summarizer.summarize(
      this.chatId,
      history,
      this.limit
    );
    if (summarized) {
      await this.summarizer.assessUsers(this.chatId, history);
    }
    const localStoreCount = this.localStore.getCount(this.chatId);
    const removedCount = summarized ? history.length : 0;
    this.logger.debug(
      {
        chatId: this.chatId,
        summarized,
        removedCount,
        localStoreCount,
      },
      'Summarization result'
    );
    return id;
  }

  public getHistory(): Promise<ChatMessage[]> {
    return this.messages.getMessages(this.chatId);
  }
}

@injectable()
export class ChatMemoryManager implements ChatMemoryManagerInterface {
  private readonly logger: Logger;

  constructor(
    @inject(MESSAGE_SERVICE_ID) private messages: MessageService,
    @inject(HISTORY_SUMMARIZER_ID) private summarizer: HistorySummarizer,
    @inject(CHAT_RESET_SERVICE_ID) private resetService: ChatResetService,
    @inject(INTEREST_MESSAGE_STORE_ID) private localStore: InterestMessageStore,
    @inject(CHAT_CONFIG_SERVICE_ID) private config: ChatConfigService,
    @inject(LOGGER_FACTORY_ID) private loggerFactory: LoggerFactory
  ) {
    this.logger = this.loggerFactory.create('ChatMemoryManager');
  }

  public async get(chatId: number): Promise<ChatMemory> {
    this.logger.debug({ chatId }, 'Creating chat memory');
    const { historyLimit } = await this.config.getConfig(chatId);
    return new ChatMemory(
      this.messages,
      this.summarizer,
      this.localStore,
      chatId,
      historyLimit,
      this.loggerFactory
    );
  }

  public async reset(chatId: number): Promise<void> {
    this.logger.debug({ chatId }, 'Resetting chat memory');
    await this.resetService.reset(chatId);
    this.localStore.clearMessages(chatId);
  }
}
