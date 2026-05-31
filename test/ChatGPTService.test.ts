import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '../src/domain/messages/ChatMessage';
import type { ChatGPTService as ChatGPTServiceType } from '../src/infrastructure/external/ChatGPTService';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { DEFAULT_BEHAVIOR_PIPELINE_CONFIG } from '../src/application/behavior/BehaviorConfig';
import type { PromptDirector } from '../src/application/prompts/PromptDirector';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

interface ChatGPTServiceConstructor {
  new (
    env: TestEnvService,
    prompts: PromptDirector,
    behaviorConfig: typeof DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
    logger: LoggerFactory
  ): ChatGPTServiceType;
}

describe('ChatGPTService', () => {
  let ChatGPTService: ChatGPTServiceConstructor;
  let service: ChatGPTServiceType;
  let openaiCreate: ReturnType<typeof vi.fn<[], unknown>>;
  let prompts: Record<string, unknown>;
  let env: TestEnvService;
  let loggerFactory: LoggerFactory;

  beforeEach(async () => {
    vi.resetModules();

    openaiCreate = vi.fn<[], unknown>();
    const openaiMock = { chat: { completions: { create: openaiCreate } } };
    vi.doMock('openai', () => ({ default: vi.fn(() => openaiMock) }));

    prompts = {
      createSummaryPrompt: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'summary' }]),
      createTopicOfDayPrompt: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'topic' }]),
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
    ({ ChatGPTService } =
      await import('../src/infrastructure/external/ChatGPTService'));
    service = new ChatGPTService(
      env,
      prompts as unknown as PromptDirector,
      DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
      loggerFactory
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_PROMPTS;
  });

  it('generateTopicOfDay sends prompt', async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'article' } }],
    });
    const res = await service.generateTopicOfDay();
    expect(res).toBe('article');
    expect(openaiCreate).toHaveBeenCalledWith({
      model: env.getModels().behaviorDecision.default,
      messages: [{ role: 'user', content: 'topic' }],
    });
    expect(prompts.createTopicOfDayPrompt).toHaveBeenCalled();
  });

  it('generateTopicOfDay passes context params to director', async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'article' } }],
    });
    const res = await service.generateTopicOfDay({
      chatTitle: 'Chat',
      summary: 'S',
      users: [{ username: 'u', fullName: 'F' }],
    });
    expect(res).toBe('article');
    expect(prompts.createTopicOfDayPrompt).toHaveBeenCalledWith({
      chatTitle: 'Chat',
      users: [{ username: 'u', fullName: 'F' }],
      summary: 'S',
    });
  });

  it('summarize builds history and uses previous summary', async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: undefined } }],
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
    expect(openaiCreate).toHaveBeenCalledWith({
      model: env.getModels().summarization.default,
      messages: [{ role: 'user', content: 'summary' }],
    });
    expect(prompts.createSummaryPrompt).toHaveBeenCalledWith(history, 'prev');
  });

  it('summarize works without previous summary', async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'sum' } }],
    });
    const resSum = await service.summarize([]);
    expect(resSum).toBe('sum');
    expect(openaiCreate).toHaveBeenCalledWith({
      model: env.getModels().summarization.default,
      messages: [{ role: 'user', content: 'summary' }],
    });
    expect(prompts.createSummaryPrompt).toHaveBeenCalledWith([], undefined);
  });

  it('logPrompt writes only when LOG_PROMPTS=true', async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'r' } }],
    });
    const appendSpy = vi.spyOn(fs, 'appendFile').mockResolvedValue(undefined);

    const env1 = new TestEnvService();
    (env1.env as unknown as { LOG_PROMPTS: boolean }).LOG_PROMPTS = false;
    const service1 = new ChatGPTService(
      env1,
      prompts as unknown as PromptDirector,
      DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
      loggerFactory
    );
    await service1.summarize([]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appendSpy).not.toHaveBeenCalled();

    const env2 = new TestEnvService();
    (env2.env as unknown as { LOG_PROMPTS: boolean }).LOG_PROMPTS = true;
    const service2 = new ChatGPTService(
      env2,
      prompts as unknown as PromptDirector,
      DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
      loggerFactory
    );
    await service2.summarize([]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appendSpy).toHaveBeenCalled();
  });
});
