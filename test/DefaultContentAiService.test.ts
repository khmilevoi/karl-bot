import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiGateway } from '../src/application/interfaces/ai/AiGateway';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { PromptDirector } from '../src/application/prompts/PromptDirector';
import { DefaultContentAiService } from '../src/application/use-cases/ai/DefaultContentAiService';
import type { ChatMessage } from '../src/domain/messages/ChatMessage';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';

describe('DefaultContentAiService', () => {
  let service: DefaultContentAiService;
  let createChatCompletion: ReturnType<typeof vi.fn>;
  let prompts: Record<string, unknown>;
  let env: TestEnvService;
  let gateway: AiGateway;
  let loggerFactory: LoggerFactory;

  beforeEach(() => {
    createChatCompletion = vi.fn();
    gateway = {
      createChatCompletion,
    } as unknown as AiGateway;

    prompts = {
      createSummaryPrompt: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'summary' }]),
    };

    env = new TestEnvService();
    loggerFactory = {
      create: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    } as unknown as LoggerFactory;
    service = new DefaultContentAiService(
      env,
      prompts as unknown as PromptDirector,
      gateway,
      loggerFactory
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_PROMPTS;
  });

  it('summarize builds history and uses previous summary', async () => {
    createChatCompletion.mockResolvedValueOnce({
      content: '',
      model: env.getModels().summarization.default,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      raw: {},
    });
    const history: ChatMessage[] = [
      {
        role: 'user',
        content: 'u1',
        messageId: 1,
        username: 'u',
        fullName: 'U',
      },
      { role: 'assistant', content: 'a1' },
    ];

    const res = await service.summarize(history, 'prev');

    expect(res).toBe('prev');
    expect(createChatCompletion).toHaveBeenCalledWith({
      model: env.getModels().summarization.default,
      messages: [{ role: 'user', content: 'summary' }],
    });
    expect(prompts.createSummaryPrompt).toHaveBeenCalledWith(history, 'prev');
  });

  it('summarize works without previous summary', async () => {
    createChatCompletion.mockResolvedValueOnce({
      content: 'sum',
      model: env.getModels().summarization.default,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      raw: {},
    });

    const resSum = await service.summarize([]);

    expect(resSum).toBe('sum');
    expect(createChatCompletion).toHaveBeenCalledWith({
      model: env.getModels().summarization.default,
      messages: [{ role: 'user', content: 'summary' }],
    });
    expect(prompts.createSummaryPrompt).toHaveBeenCalledWith([], undefined);
  });

  it('logPrompt writes only when LOG_PROMPTS=true', async () => {
    createChatCompletion.mockResolvedValue({
      content: 'r',
      model: env.getModels().summarization.default,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      raw: {},
    });
    const appendSpy = vi.spyOn(fs, 'appendFile').mockResolvedValue(undefined);

    const env1 = new TestEnvService();
    (env1.env as unknown as { LOG_PROMPTS: boolean }).LOG_PROMPTS = false;
    const service1 = new DefaultContentAiService(
      env1,
      prompts as unknown as PromptDirector,
      gateway,
      loggerFactory
    );
    await service1.summarize([]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appendSpy).not.toHaveBeenCalled();

    const env2 = new TestEnvService();
    (env2.env as unknown as { LOG_PROMPTS: boolean }).LOG_PROMPTS = true;
    const service2 = new DefaultContentAiService(
      env2,
      prompts as unknown as PromptDirector,
      gateway,
      loggerFactory
    );
    await service2.summarize([]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appendSpy).toHaveBeenCalled();
  });
});
