import { promises as fs } from 'fs';
import { inject, injectable } from 'inversify';
import path from 'path';

import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import type { AIService } from '@/application/interfaces/ai/AIService';
import {
  OPEN_AI_GATEWAY_ID,
  type OpenAiGateway,
  type OpenAiMessage,
} from '@/application/interfaces/ai/OpenAiGateway';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  PROMPT_DIRECTOR_ID,
  type PromptDirector,
} from '@/application/prompts/PromptDirector';
import type { PromptMessage } from '@/application/prompts/PromptMessage';
import type { ChatMessage } from '@/domain/messages/ChatMessage';

@injectable()
export class CarlContentAiService implements AIService {
  private readonly behaviorDecisionModel: AiModelId;
  private readonly summarizationModel: AiModelId;
  private readonly logger: Logger;

  constructor(
    @inject(ENV_SERVICE_ID) private readonly envService: EnvService,
    @inject(PROMPT_DIRECTOR_ID) private readonly prompts: PromptDirector,
    @inject(OPEN_AI_GATEWAY_ID) private readonly gateway: OpenAiGateway,
    @inject(LOGGER_FACTORY_ID) private readonly loggerFactory: LoggerFactory
  ) {
    const models = this.envService.getModels();
    this.behaviorDecisionModel = models.behaviorDecision.default;
    this.summarizationModel = models.summarization.default;
    this.logger = this.loggerFactory.create('CarlContentAiService');
  }

  public async generateTopicOfDay(params?: {
    chatTitle?: string;
    summary?: string;
    users?: { username: string; fullName: string }[];
  }): Promise<string> {
    const prompt = await this.prompts.createTopicOfDayPrompt({
      chatTitle: params?.chatTitle,
      users: params?.users,
      summary: params?.summary,
    });
    const messages = this.toOpenAiMessages(prompt);
    this.logger.debug('Sending topic of day request');
    const start = Date.now();
    try {
      const result = await this.gateway.createChatCompletion({
        model: this.behaviorDecisionModel,
        messages,
      });
      const elapsedMs = Date.now() - start;
      this.logger.debug(
        {
          model: result.model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          elapsedMs,
        },
        'Received topic of day response'
      );
      void this.logPrompt('topicOfDay', messages, result.content);
      return result.content;
    } catch (err) {
      const elapsedMs = Date.now() - start;
      this.logger.error(
        {
          err,
          model: this.behaviorDecisionModel,
          messages: messages.length,
          elapsedMs,
        },
        'Topic of day request failed'
      );
      throw err;
    }
  }

  public async summarize(
    history: ChatMessage[],
    prev?: string
  ): Promise<string> {
    this.logger.debug(
      {
        history: history.length,
        prevLength: prev?.length ?? 0,
      },
      'Sending summarization request'
    );
    const prompt = await this.prompts.createSummaryPrompt(history, prev);
    const messages = this.toOpenAiMessages(prompt);
    const start = Date.now();
    try {
      const result = await this.gateway.createChatCompletion({
        model: this.summarizationModel,
        messages,
      });
      const elapsedMs = Date.now() - start;
      this.logger.debug(
        {
          model: result.model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
          elapsedMs,
        },
        'Received summary response'
      );
      const response = result.content || prev || '';
      void this.logPrompt('summary', messages, response);
      return response;
    } catch (err) {
      const elapsedMs = Date.now() - start;
      this.logger.error(
        {
          err,
          model: this.summarizationModel,
          messages: messages.length,
          elapsedMs,
        },
        'Summarization request failed'
      );
      throw err;
    }
  }

  private async logPrompt(
    type: string,
    messages: OpenAiMessage[],
    response?: unknown
  ): Promise<void> {
    if (!this.envService.env.LOG_PROMPTS) {
      return;
    }
    const filePath = path.join(process.cwd(), 'prompts.log');
    const responseText =
      typeof response === 'string'
        ? response
        : JSON.stringify(response, null, 2);
    const entry = `\n[${new Date().toISOString()}] ${type}\nPROMPT:\n${JSON.stringify(
      messages,
      null,
      2
    )}\n${response != null ? `RESPONSE:\n${responseText}\n` : ''}---\n`;
    try {
      await fs.appendFile(filePath, entry);
    } catch (err) {
      this.logger.error({ err }, 'Failed to write prompt log');
    }
  }

  private toOpenAiMessages(messages: PromptMessage[]): OpenAiMessage[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }
}
