import type { Context } from 'telegraf';
import { describe, expect, it, vi } from 'vitest';

import { MainService } from '../src/view/telegram/MainService';
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
  telegram: { setMyCommands: vi.fn().mockResolvedValue(undefined) },
  on: vi.fn(),
  command: vi.fn(),
  action: vi.fn(),
  use: vi.fn(),
});

const createMockMessenger = () =>
  ({
    bot: createMockBot(),
    launch: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    sendMessage: vi.fn(),
  }) as unknown as ChatMessenger;

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
      getConfig: vi
        .fn()
        .mockResolvedValue({
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
      getConfig: vi
        .fn()
        .mockResolvedValue({
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
    const adminCtx = { chat: { id: 1 } } as Context;
    await (service as any).handleMessage(adminCtx);

    expect(pipeline.shouldRespond).not.toHaveBeenCalled();
    expect(extractor.extract).not.toHaveBeenCalled();
  });
});
