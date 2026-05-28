import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '../src/domain/messages/ChatMessage';
import type { ChatGPTService as ChatGPTServiceType } from '../src/infrastructure/external/ChatGPTService';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import type { PromptDirector } from '../src/application/prompts/PromptDirector';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

interface ChatGPTServiceConstructor {
  new (
    env: TestEnvService,
    prompts: PromptDirector,
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
      createAnswerPrompt: vi.fn().mockResolvedValue([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'answer' },
      ]),
      createInterestPrompt: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'interest' }]),
      createAssessUsersPrompt: vi
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'assess' }]),
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
      loggerFactory
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOG_PROMPTS;
  });

  it('ask forms messages and respects triggerReason', async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'resp' } }],
    });
    const history: ChatMessage[] = [
      {
        role: 'user',
        content: 'hi',
        messageId: 1,
        username: 'u',
        fullName: 'First Last',
        firstName: 'First',
        lastName: 'Last',
        replyText: 'r',
        quoteText: 'q',
        attitude: 'good',
      },
      { role: 'assistant', content: 'yo' },
      {
        role: 'user',
        content: 'again',
        messageId: 2,
        username: 'u',
        fullName: 'First Last',
        firstName: 'First',
        lastName: 'Last',
        attitude: 'good',
      },
    ];
    const triggerReason = { why: 'why', message: 'msg' };
    const res = await service.ask(history, 'sum', triggerReason);
    expect(res).toBe('resp');
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(openaiCreate).toHaveBeenCalledWith({
      model: env.getModels().ask,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'answer' },
      ],
    });
    expect(prompts.createAnswerPrompt).toHaveBeenCalledWith(
      history,
      'sum',
      triggerReason
    );
  });

  it('checkInterest parses JSON response and handles errors', async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: '{"messageId":"1","why":"w"}' } }],
    });
    const history: ChatMessage[] = [
      {
        role: 'user',
        content: 'm',
        messageId: 1,
        username: 'u',
        fullName: 'U',
      },
    ];
    const res = await service.checkInterest(history, '');
    expect(res).toEqual({ messageId: '1', why: 'w' });
    expect(openaiCreate).toHaveBeenCalledWith({
      model: env.getModels().interest,
      messages: [{ role: 'user', content: 'interest' }],
    });
    expect(prompts.createInterestPrompt).toHaveBeenCalledWith(history);

    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not-json' } }],
    });
    const res2 = await service.checkInterest(history, '');
    expect(res2).toBeNull();
  });

  it('assessUsers adds previous attitudes and parses response', async () => {
    openaiCreate.mockResolvedValue({
      choices: [
        {
          message: { content: '[{"username":"u","attitude":"new"}]' },
        },
      ],
    });
    const history: ChatMessage[] = [
      {
        role: 'user',
        content: 'h',
        messageId: 1,
        username: 'u',
        fullName: 'First Last',
        firstName: 'First',
        lastName: 'Last',
      },
    ];
    const res = await service.assessUsers(history, [
      { username: 'u', attitude: 'old' },
    ]);
    expect(res).toEqual([{ username: 'u', attitude: 'new' }]);
    expect(openaiCreate).toHaveBeenCalledWith({
      model: env.getModels().summary,
      messages: [{ role: 'user', content: 'assess' }],
    });
    expect(prompts.createAssessUsersPrompt).toHaveBeenCalledWith(history, [
      { username: 'u', attitude: 'old' },
    ]);

    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'oops' } }],
    });
    const res2 = await service.assessUsers(history);
    expect(res2).toEqual([]);
  });

  it('generateTopicOfDay sends prompt', async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: 'article' } }],
    });
    const res = await service.generateTopicOfDay();
    expect(res).toBe('article');
    expect(openaiCreate).toHaveBeenCalledWith({
      model: env.getModels().ask,
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
      users: [{ username: 'u', fullName: 'F', attitude: 'a' }],
    });
    expect(res).toBe('article');
    expect(prompts.createTopicOfDayPrompt).toHaveBeenCalledWith({
      chatTitle: 'Chat',
      users: [{ username: 'u', fullName: 'F', attitude: 'a' }],
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
      model: env.getModels().summary,
      messages: [{ role: 'user', content: 'summary' }],
    });
    expect(prompts.createSummaryPrompt).toHaveBeenCalledWith(history, 'prev');
  });

  it('ask without optional params and summarize without prev', async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'resp' } }],
    });
    const resAsk = await service.ask([]);
    expect(resAsk).toBe('resp');
    expect(openaiCreate).toHaveBeenCalledWith({
      model: env.getModels().ask,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'answer' },
      ],
    });
    expect(prompts.createAnswerPrompt).toHaveBeenCalledWith(
      [],
      undefined,
      undefined
    );

    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'sum' } }],
    });
    const resSum = await service.summarize([]);
    expect(resSum).toBe('sum');
    expect(openaiCreate).toHaveBeenCalledWith({
      model: env.getModels().summary,
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
      loggerFactory
    );
    await service1.ask([]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appendSpy).not.toHaveBeenCalled();

    const env2 = new TestEnvService();
    (env2.env as unknown as { LOG_PROMPTS: boolean }).LOG_PROMPTS = true;
    const service2 = new ChatGPTService(
      env2,
      prompts as unknown as PromptDirector,
      loggerFactory
    );
    await service2.ask([]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appendSpy).toHaveBeenCalled();
  });
});
