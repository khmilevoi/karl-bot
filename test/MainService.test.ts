import type { Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { MainService } from '../src/view/telegram/MainService';
import type { BotContext } from '../src/view/telegram/context';
import type { EnvService } from '../src/application/interfaces/env/EnvService';
import type { ChatMemoryManager } from '../src/application/interfaces/chat/ChatMemoryManager';
import type { AdminService } from '../src/application/interfaces/admin/AdminService';
import type { ChatApprovalService } from '../src/application/interfaces/chat/ChatApprovalService';
import type { MessageContextExtractor } from '../src/application/interfaces/messages/MessageContextExtractor';
import type { TriggerPipeline } from '../src/application/interfaces/chat/TriggerPipeline';
import type { ChatResponder } from '../src/application/interfaces/chat/ChatResponder';
import type { ChatInfoService } from '../src/application/interfaces/chat/ChatInfoService';
import type { ChatConfigService } from '../src/application/interfaces/chat/ChatConfigService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { TopicOfDayScheduler } from '../src/application/interfaces/scheduler/TopicOfDayScheduler';
import type { ChatMessenger } from '../src/application/interfaces/chat/ChatMessenger';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  }) as unknown as LoggerFactory;

class MockEnvService {
  env = { BOT_TOKEN: 'token', ADMIN_CHAT_ID: 1 };
}

const createMockBot = () => ({
  api: {
    setMyCommands: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  },
  on: vi.fn(),
  command: vi.fn(),
  use: vi.fn(),
  callbackQuery: vi.fn(),
});

const createMockMessenger = () =>
  ({
    bot: createMockBot(),
    launch: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    sendMessage: vi.fn(),
  }) as unknown as ChatMessenger;

const makeDeps = (over: Partial<Record<string, unknown>> = {}) => ({
  memories: { get: vi.fn(), reset: vi.fn().mockResolvedValue(undefined) },
  admin: {
    hasAccess: vi.fn().mockResolvedValue(true),
    exportTables: vi.fn().mockResolvedValue([]),
    exportChatData: vi.fn().mockResolvedValue([]),
    createAccessKey: vi.fn(),
  },
  approval: {
    getStatus: vi.fn().mockResolvedValue('approved'),
    pending: vi.fn(),
    approve: vi.fn(),
    ban: vi.fn(),
    unban: vi.fn(),
    listAll: vi.fn().mockResolvedValue([]),
  },
  extractor: { extract: vi.fn() },
  pipeline: { shouldRespond: vi.fn() },
  responder: { generate: vi.fn() },
  chatInfo: { getChat: vi.fn() },
  config: {
    getConfig: vi.fn().mockResolvedValue({
      historyLimit: 50,
      interestInterval: 25,
      topicTime: null,
      topicTimezone: 'UTC',
    }),
    setHistoryLimit: vi.fn(),
    setInterestInterval: vi.fn(),
    setTopicTime: vi.fn(),
  },
  scheduler: { start: vi.fn().mockResolvedValue(undefined) },
  ...over,
});

const buildService = (deps: ReturnType<typeof makeDeps>) =>
  new MainService(
    new MockEnvService() as unknown as EnvService,
    deps.memories as unknown as ChatMemoryManager,
    deps.admin as unknown as AdminService,
    deps.approval as unknown as ChatApprovalService,
    deps.extractor as unknown as MessageContextExtractor,
    deps.pipeline as unknown as TriggerPipeline,
    deps.responder as unknown as ChatResponder,
    deps.chatInfo as unknown as ChatInfoService,
    deps.config as unknown as ChatConfigService,
    createLoggerFactory(),
    deps.scheduler as unknown as TopicOfDayScheduler,
    createMockMessenger()
  );

describe('MainService (Minimal)', () => {
  it('launches and stops the bot', async () => {
    const memories = {
      get: vi.fn(),
      reset: vi.fn(),
    } as unknown as ChatMemoryManager;
    const admin = {
      hasAccess: vi.fn(),
      exportTables: vi.fn(),
      exportChatData: vi.fn(),
      createAccessKey: vi.fn(),
    } as unknown as AdminService;
    const approval = {
      getStatus: vi.fn().mockResolvedValue('approved'),
      pending: vi.fn(),
      approve: vi.fn(),
      ban: vi.fn(),
      unban: vi.fn(),
      listAll: vi.fn().mockResolvedValue([]),
    } as unknown as ChatApprovalService;
    const extractor = {
      extract: vi.fn(),
    } as unknown as MessageContextExtractor;
    const pipeline = { shouldRespond: vi.fn() } as unknown as TriggerPipeline;
    const responder = { generate: vi.fn() } as unknown as ChatResponder;
    const chatInfo = { getChat: vi.fn() } as unknown as ChatInfoService;
    const config = {
      getConfig: vi.fn().mockResolvedValue({
        historyLimit: 50,
        interestInterval: 25,
        topicTime: null,
        topicTimezone: 'UTC',
      }),
      setHistoryLimit: vi.fn(),
      setInterestInterval: vi.fn(),
      setTopicTime: vi.fn(),
    } as unknown as ChatConfigService;
    const scheduler = {
      start: vi.fn().mockResolvedValue(undefined),
    } as unknown as TopicOfDayScheduler;
    const messenger = createMockMessenger();

    const service = new MainService(
      new MockEnvService() as unknown as EnvService,
      memories,
      admin,
      approval,
      extractor,
      pipeline,
      responder,
      chatInfo,
      config,
      createLoggerFactory(),
      scheduler,
      messenger
    );

    await service.launch();
    service.stop('test');

    expect(messenger.launch).toHaveBeenCalled();
    expect(scheduler.start).toHaveBeenCalled();
    expect(messenger.stop).toHaveBeenCalledWith('test');
  });

  it('gets chat config through getChatData', async () => {
    const memories = {
      get: vi.fn(),
      reset: vi.fn(),
    } as unknown as ChatMemoryManager;
    const admin = {
      hasAccess: vi.fn(),
      exportTables: vi.fn(),
      exportChatData: vi.fn(),
      createAccessKey: vi.fn(),
    } as unknown as AdminService;
    const approval = {
      getStatus: vi.fn().mockResolvedValue('approved'),
      pending: vi.fn(),
      approve: vi.fn(),
      ban: vi.fn(),
      unban: vi.fn(),
      listAll: vi.fn().mockResolvedValue([]),
    } as unknown as ChatApprovalService;
    const extractor = {
      extract: vi.fn(),
    } as unknown as MessageContextExtractor;
    const pipeline = { shouldRespond: vi.fn() } as unknown as TriggerPipeline;
    const responder = { generate: vi.fn() } as unknown as ChatResponder;
    const chatInfo = { getChat: vi.fn() } as unknown as ChatInfoService;
    const config = {
      getConfig: vi.fn().mockResolvedValue({
        historyLimit: 50,
        interestInterval: 25,
        topicTime: '09:00',
        topicTimezone: 'UTC',
      }),
      setHistoryLimit: vi.fn(),
      setInterestInterval: vi.fn(),
      setTopicTime: vi.fn(),
    } as unknown as ChatConfigService;
    const scheduler = {
      start: vi.fn().mockResolvedValue(undefined),
    } as unknown as TopicOfDayScheduler;
    const messenger = createMockMessenger();

    const service = new MainService(
      new MockEnvService() as unknown as EnvService,
      memories,
      admin,
      approval,
      extractor,
      pipeline,
      responder,
      chatInfo,
      config,
      createLoggerFactory(),
      scheduler,
      messenger
    );

    const chatData = await (service as any).getChatData(1);

    expect(chatData).toEqual({
      chatId: 1,
      status: 'approved',
      config: {
        historyLimit: 50,
        interestInterval: 25,
        topicTime: '09:00',
        topicTimezone: 'UTC',
      },
    });
    expect(approval.getStatus).toHaveBeenCalledWith(1);
    expect(config.getConfig).toHaveBeenCalledWith(1);
  });

  it('handles message processing with admin chat skip', async () => {
    const memories = {
      get: vi.fn(),
      reset: vi.fn(),
    } as unknown as ChatMemoryManager;
    const admin = {
      hasAccess: vi.fn(),
      exportTables: vi.fn(),
      exportChatData: vi.fn(),
      createAccessKey: vi.fn(),
    } as unknown as AdminService;
    const approval = {
      getStatus: vi.fn().mockResolvedValue('approved'),
      pending: vi.fn(),
      approve: vi.fn(),
      ban: vi.fn(),
      unban: vi.fn(),
      listAll: vi.fn().mockResolvedValue([]),
    } as unknown as ChatApprovalService;
    const extractor = {
      extract: vi.fn(),
    } as unknown as MessageContextExtractor;
    const pipeline = { shouldRespond: vi.fn() } as unknown as TriggerPipeline;
    const responder = { generate: vi.fn() } as unknown as ChatResponder;
    const chatInfo = { getChat: vi.fn() } as unknown as ChatInfoService;
    const config = {
      getConfig: vi.fn().mockResolvedValue({
        historyLimit: 50,
        interestInterval: 25,
        topicTime: null,
        topicTimezone: 'UTC',
      }),
      setHistoryLimit: vi.fn(),
      setInterestInterval: vi.fn(),
      setTopicTime: vi.fn(),
    } as unknown as ChatConfigService;
    const scheduler = {
      start: vi.fn().mockResolvedValue(undefined),
    } as unknown as TopicOfDayScheduler;
    const messenger = createMockMessenger();

    const service = new MainService(
      new MockEnvService() as unknown as EnvService,
      memories,
      admin,
      approval,
      extractor,
      pipeline,
      responder,
      chatInfo,
      config,
      createLoggerFactory(),
      scheduler,
      messenger
    );

    // Test admin chat - should return early
    const adminCtx = { chat: { id: 1 } } as unknown as Context;
    await (service as any).handleMessage(adminCtx);

    expect(pipeline.shouldRespond).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
  });
});

describe('MainService.handleResetMemory', () => {
  it('returns "denied" without resetting when a non-admin lacks access', async () => {
    const deps = makeDeps();
    deps.admin.hasAccess = vi.fn().mockResolvedValue(false);
    const service = buildService(deps);

    const ctx = { chat: { id: 2 }, from: { id: 5 } } as unknown as BotContext;
    const result = await (service as any).handleResetMemory(ctx);

    expect(result).toBe('denied');
    expect(deps.memories.reset).not.toHaveBeenCalled();
  });

  it('resets and returns "ok" for an authorized user', async () => {
    const deps = makeDeps();
    deps.admin.hasAccess = vi.fn().mockResolvedValue(true);
    const service = buildService(deps);

    const ctx = { chat: { id: 2 }, from: { id: 5 } } as unknown as BotContext;
    const result = await (service as any).handleResetMemory(ctx);

    expect(result).toBe('ok');
    expect(deps.memories.reset).toHaveBeenCalledWith(2);
  });

  it('skips the access check for the admin chat', async () => {
    const deps = makeDeps();
    const service = buildService(deps);

    const ctx = { chat: { id: 1 }, from: { id: 5 } } as unknown as BotContext;
    const result = await (service as any).handleResetMemory(ctx);

    expect(result).toBe('ok');
    expect(deps.admin.hasAccess).not.toHaveBeenCalled();
    expect(deps.memories.reset).toHaveBeenCalledWith(1);
  });
});

describe('MainService.handleExportData', () => {
  const makeExportCtx = () =>
    ({
      chat: { id: 2 },
      from: { id: 5 },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      replyWithDocument: vi.fn().mockResolvedValue(undefined),
      api: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
      },
    }) as unknown as BotContext;

  it('reports no data when there are no files', async () => {
    const deps = makeDeps();
    deps.admin.exportChatData = vi.fn().mockResolvedValue([]);
    const service = buildService(deps);
    const ctx = makeExportCtx();

    await (service as any).handleExportData(ctx, 10);

    expect(ctx.replyWithDocument).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('Нет данных для экспорта.');
  });

  it('sends each file and updates progress', async () => {
    const deps = makeDeps();
    deps.admin.exportChatData = vi.fn().mockResolvedValue([
      { buffer: Buffer.from('a'), filename: 'a.csv' },
      { buffer: Buffer.from('b'), filename: 'b.csv' },
    ]);
    const service = buildService(deps);
    const ctx = makeExportCtx();

    await (service as any).handleExportData(ctx, 10);

    expect(ctx.replyWithDocument).toHaveBeenCalledTimes(2);
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  });

  it('reports an error when export throws', async () => {
    const deps = makeDeps();
    deps.admin.exportChatData = vi.fn().mockRejectedValue(new Error('boom'));
    const service = buildService(deps);
    const ctx = makeExportCtx();

    await (service as any).handleExportData(ctx, 10);

    expect(ctx.reply).toHaveBeenCalledWith('❌ Ошибка при загрузке данных.');
  });
});
