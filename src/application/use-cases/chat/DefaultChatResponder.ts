import type { Context } from 'grammy';
import { inject, injectable } from 'inversify';

import type { AIService } from '@/application/interfaces/ai/AIService';
import { AI_SERVICE_ID } from '@/application/interfaces/ai/AIService';
import type { ChatMemoryManager } from '@/application/interfaces/chat/ChatMemoryManager';
import { CHAT_MEMORY_MANAGER_ID } from '@/application/interfaces/chat/ChatMemoryManager';
import { type ChatResponder } from '@/application/interfaces/chat/ChatResponder';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type { SummaryService } from '@/application/interfaces/summaries/SummaryService';
import { SUMMARY_SERVICE_ID } from '@/application/interfaces/summaries/SummaryService';
import { MessageFactory } from '@/application/use-cases/messages/MessageFactory';
import type { TriggerReason } from '@/domain/triggers/Trigger';

@injectable()
export class DefaultChatResponder implements ChatResponder {
  private readonly logger: Logger;

  constructor(
    @inject(AI_SERVICE_ID) private ai: AIService,
    @inject(CHAT_MEMORY_MANAGER_ID) private memories: ChatMemoryManager,
    @inject(SUMMARY_SERVICE_ID) private summaries: SummaryService,
    @inject(LOGGER_FACTORY_ID) private loggerFactory: LoggerFactory
  ) {
    this.logger = this.loggerFactory.create('DefaultChatResponder');
  }

  async generate(
    ctx: Context,
    chatId: number,
    triggerReason?: TriggerReason
  ): Promise<string> {
    const memory = await this.memories.get(chatId);
    const history = await memory.getHistory();
    const summary = await this.summaries.getSummary(chatId);
    const start = Date.now();
    const answer = await this.ai.ask(history, summary, triggerReason);
    const responseTimeMs = Date.now() - start;
    this.logger.debug(
      {
        chatId,
        historyLength: history.length,
        hasSummary: Boolean(summary),
        responseTimeMs,
      },
      'Generated chat response'
    );
    await memory.addMessage(MessageFactory.fromAssistant(ctx, answer));
    return answer;
  }
}
