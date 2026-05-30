import { promises as fs } from 'fs';
import { inject, injectable } from 'inversify';
import OpenAI from 'openai';
import type { ChatModel } from 'openai/resources/shared';
import path from 'path';

import type { AIService } from '@/application/interfaces/ai/AIService';
import type { EnvService } from '@/application/interfaces/env/EnvService';
import { ENV_SERVICE_ID } from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type { PromptDirector } from '@/application/prompts/PromptDirector';
import { PROMPT_DIRECTOR_ID } from '@/application/prompts/PromptDirector';
import type { PromptMessage } from '@/application/prompts/PromptMessage';
import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { TriggerReason } from '@/domain/triggers/Trigger';

@injectable()
export class ChatGPTService implements AIService {
  private openai: OpenAI;
  private readonly triggerGateModel: ChatModel;
  private readonly behaviorDecisionModel: ChatModel;
  private readonly behaviorDecisionEscalationModel: ChatModel;
  private readonly summarizationModel: ChatModel;
  private readonly logger: Logger;

  constructor(
    @inject(ENV_SERVICE_ID) private readonly envService: EnvService,
    @inject(PROMPT_DIRECTOR_ID) private readonly prompts: PromptDirector,
    @inject(LOGGER_FACTORY_ID) private loggerFactory: LoggerFactory
  ) {
    const env = this.envService.env;
    this.openai = new OpenAI({ apiKey: env.OPENAI_KEY });
    const models = this.envService.getModels();
    this.triggerGateModel = models.triggerGate.default;
    this.behaviorDecisionModel = models.behaviorDecision.default;
    this.behaviorDecisionEscalationModel = models.behaviorDecision.escalation;
    this.summarizationModel = models.summarization.default;
    this.logger = this.loggerFactory.create('ChatGPTService');
    this.logger.debug('ChatGPTService initialized');
  }

  public async ask(
    history: ChatMessage[],
    summary?: string,
    triggerReason?: TriggerReason
  ): Promise<string> {
    this.logger.debug(
      {
        messages: history.length,
        summary: !!summary,
      },
      'Sending chat completion request'
    );

    const prompt = await this.prompts.createAnswerPrompt(
      history,
      summary,
      triggerReason
    );
    const messages = this.toOpenAiMessages(prompt);
    const start = Date.now();
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.behaviorDecisionModel,
        messages,
      });
      const elapsedMs = Date.now() - start;
      this.logger.debug(
        {
          model: completion.model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
          elapsedMs,
        },
        'Received chat completion response'
      );
      const response = completion.choices[0]?.message?.content ?? '';
      void this.logPrompt('ask', messages, response);
      return response;
    } catch (err) {
      const elapsedMs = Date.now() - start;
      this.logger.error(
        {
          err,
          model: this.behaviorDecisionModel,
          messages: messages.length,
          elapsedMs,
        },
        'Chat completion request failed'
      );
      throw err;
    }
  }

  public async checkInterest(
    history: ChatMessage[],
    _summary: string
  ): Promise<{ messageId: string; why: string } | null> {
    const prompt = await this.prompts.createInterestPrompt(history);
    const messages = this.toOpenAiMessages(prompt);
    this.logger.debug(
      {
        messages: history.length,
      },
      'Sending interest check request'
    );
    const start = Date.now();
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.triggerGateModel,
        messages,
      });
      const elapsedMs = Date.now() - start;
      this.logger.debug(
        {
          model: completion.model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
          elapsedMs,
        },
        'Received interest check response'
      );
      const content = completion.choices[0]?.message?.content ?? '';
      void this.logPrompt('interest', messages, content);
      try {
        return JSON.parse(content) as {
          messageId: string;
          why: string;
        } | null;
      } catch (err) {
        this.logger.error(
          {
            err,
            content,
          },
          'Failed to parse interest response'
        );
        return null;
      }
    } catch (err) {
      const elapsedMs = Date.now() - start;
      this.logger.error(
        {
          err,
          model: this.triggerGateModel,
          messages: messages.length,
          elapsedMs,
        },
        'Interest check request failed'
      );
      throw err;
    }
  }

  public async assessUsers(
    messages: ChatMessage[],
    prevAttitudes: { username: string; attitude: string }[] = []
  ): Promise<{ username: string; attitude: string }[]> {
    const prompt = await this.prompts.createAssessUsersPrompt(
      messages,
      prevAttitudes
    );
    const reqMessages = this.toOpenAiMessages(prompt);
    this.logger.debug(
      {
        messages: messages.length,
      },
      'Sending user attitude assessment request'
    );
    const start = Date.now();
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.summarizationModel,
        messages: reqMessages,
      });
      const elapsedMs = Date.now() - start;
      this.logger.debug(
        {
          model: completion.model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
          elapsedMs,
        },
        'Received user attitude assessment response'
      );
      const content = completion.choices[0]?.message?.content ?? '[]';
      void this.logPrompt('assessUsers', reqMessages, content);
      try {
        return JSON.parse(content) as { username: string; attitude: string }[];
      } catch (err) {
        this.logger.error(
          {
            err,
            content,
          },
          'Failed to parse assessUsers response'
        );
        return [];
      }
    } catch (err) {
      const elapsedMs = Date.now() - start;
      this.logger.error(
        {
          err,
          model: this.summarizationModel,
          messages: reqMessages.length,
          elapsedMs,
        },
        'User attitude assessment request failed'
      );
      throw err;
    }
  }

  public async generateTopicOfDay(params?: {
    chatTitle?: string;
    summary?: string;
    users?: { username: string; fullName: string; attitude: string }[];
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
      const completion = await this.openai.chat.completions.create({
        model: this.behaviorDecisionModel,
        messages,
      });
      const elapsedMs = Date.now() - start;
      this.logger.debug(
        {
          model: completion.model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
          elapsedMs,
        },
        'Received topic of day response'
      );
      const response = completion.choices[0]?.message?.content ?? '';
      void this.logPrompt('topicOfDay', messages, response);
      return response;
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
      const completion = await this.openai.chat.completions.create({
        model: this.summarizationModel,
        messages,
      });
      const elapsedMs = Date.now() - start;
      this.logger.debug(
        {
          model: completion.model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
          elapsedMs,
        },
        'Received summary response'
      );
      const response = completion.choices[0]?.message?.content ?? prev ?? '';
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
    messages: OpenAI.ChatCompletionMessageParam[],
    response?: string
  ): Promise<void> {
    if (!this.envService.env.LOG_PROMPTS) {
      return;
    }
    const filePath = path.join(process.cwd(), 'prompts.log');
    const entry = `\n[${new Date().toISOString()}] ${type}\nPROMPT:\n${JSON.stringify(
      messages,
      null,
      2
    )}\n${response ? `RESPONSE:\n${response}\n` : ''}---\n`;
    try {
      await fs.appendFile(filePath, entry);
    } catch (err) {
      this.logger.error({ err }, 'Failed to write prompt log');
    }
  }

  private toOpenAiMessages(
    messages: PromptMessage[]
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }
}
