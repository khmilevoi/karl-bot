import { describe, expect, it, vi } from 'vitest';

import type { BehaviorPipeline } from '../src/application/behavior/BehaviorPipeline';
import type { StateEvolutionScheduler } from '../src/application/behavior/StateEvolutionScheduler';
import type { AdminService } from '../src/application/interfaces/admin/AdminService';
import type { ChatApprovalService } from '../src/application/interfaces/chat/ChatApprovalService';
import type { ChatConfigService } from '../src/application/interfaces/chat/ChatConfigService';
import type { ChatInfoService } from '../src/application/interfaces/chat/ChatInfoService';
import type { ChatMessenger } from '../src/application/interfaces/chat/ChatMessenger';
import type { ChatResetService } from '../src/application/interfaces/chat/ChatResetService';
import type { TriggerPipeline } from '../src/application/interfaces/chat/TriggerPipeline';
import type { EnvService } from '../src/application/interfaces/env/EnvService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { MessageContextExtractor } from '../src/application/interfaces/messages/MessageContextExtractor';
import type { MessageService } from '../src/application/interfaces/messages/MessageService';
import type { TopicOfDayScheduler } from '../src/application/interfaces/scheduler/TopicOfDayScheduler';
import type { VoiceMessageService } from '../src/application/interfaces/voice/VoiceMessageService';
import type { BotContext } from '../src/view/telegram/context';
import { MainService } from '../src/view/telegram/MainService';

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

const createMockBot = () => ({
  api: { deleteMessage: vi.fn() },
  on: vi.fn(),
  command: vi.fn(),
  use: vi.fn(),
  callbackQuery: vi.fn(),
});

const createMockMessenger = (bot = createMockBot()) =>
  ({
    bot,
    launch: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    sendMessage: vi.fn(),
  }) as unknown as ChatMessenger;

function makeVoiceCtx({
  chatId,
  messageId = 99,
  fileId = 'file-id',
  duration = 5,
}: {
  chatId: number;
  messageId?: number;
  fileId?: string;
  duration?: number;
}): BotContext {
  return {
    chat: { id: chatId },
    from: { id: 10, username: 'alice', first_name: 'Alice' },
    message: {
      message_id: messageId,
      voice: { file_id: fileId, duration },
    },
  } as unknown as BotContext;
}

function buildService(overrides: {
  voiceService?: Partial<VoiceMessageService>;
  approval?: Partial<ChatApprovalService>;
  adminChatId?: number;
  messenger?: ChatMessenger;
  behaviorPipeline?: Partial<BehaviorPipeline>;
}) {
  const voiceService: VoiceMessageService = {
    enqueue: vi
      .fn()
      .mockResolvedValue({ kind: 'queued', jobId: 1, messageId: 10 }),
    ...overrides.voiceService,
  } as unknown as VoiceMessageService;

  const approval: ChatApprovalService = {
    getStatus: vi.fn().mockResolvedValue('approved'),
    pending: vi.fn(),
    approve: vi.fn(),
    ban: vi.fn(),
    unban: vi.fn(),
    listAll: vi.fn().mockResolvedValue([]),
    ...overrides.approval,
  } as unknown as ChatApprovalService;

  const behaviorPipeline: BehaviorPipeline = {
    handleStoredMessage: vi.fn().mockResolvedValue({ kind: 'queued' }),
    ...overrides.behaviorPipeline,
  } as unknown as BehaviorPipeline;

  const adminChatId = overrides.adminChatId ?? 1;
  const messenger = overrides.messenger ?? createMockMessenger();

  const service = new MainService(
    {
      env: { BOT_TOKEN: 'token', ADMIN_CHAT_ID: adminChatId },
    } as unknown as EnvService,
    { reset: vi.fn() } as unknown as ChatResetService,
    {
      hasAccess: vi.fn(),
      exportTables: vi.fn(),
      exportChatData: vi.fn(),
      createAccessKey: vi.fn(),
    } as unknown as AdminService,
    approval,
    {
      extract: vi
        .fn()
        .mockReturnValue({ username: 'alice', fullName: 'Alice' }),
    } as unknown as MessageContextExtractor,
    { shouldRespond: vi.fn() } as unknown as TriggerPipeline,
    {
      addMessage: vi.fn().mockResolvedValue(1),
      getMessages: vi.fn(),
      getMessagesByIds: vi.fn(),
      getCount: vi.fn(),
      getLastMessages: vi.fn(),
      clearMessages: vi.fn(),
      findPendingVoiceById: vi.fn(),
      markVoiceTranscribed: vi.fn(),
      markVoiceFailed: vi.fn(),
    } as unknown as MessageService,
    behaviorPipeline,
    { getChat: vi.fn() } as unknown as ChatInfoService,
    {
      getConfig: vi.fn().mockResolvedValue({
        historyLimit: 50,
        topicTime: null,
        topicTimezone: 'UTC',
      }),
      setHistoryLimit: vi.fn(),
      setTopicTime: vi.fn(),
    } as unknown as ChatConfigService,
    createLoggerFactory(),
    {
      start: vi.fn().mockResolvedValue(undefined),
    } as unknown as TopicOfDayScheduler,
    { start: vi.fn() } as unknown as StateEvolutionScheduler,
    messenger,
    voiceService
  );

  return { service, voiceService, approval, behaviorPipeline };
}

describe('Telegram voice routing', () => {
  it('registers a message:voice handler in routes', () => {
    const bot = createMockBot();
    const messenger = createMockMessenger(bot);

    buildService({ messenger });

    const onCalls = bot.on.mock.calls.map((c: unknown[]) => c[0]);
    expect(onCalls).toContain('message:voice');
  });

  it('ignores voice messages from admin chat', async () => {
    const { service, voiceService } = buildService({ adminChatId: 1 });
    const ctx = makeVoiceCtx({ chatId: 1 });

    await service.handleVoiceMessage(ctx);

    expect(voiceService.enqueue).not.toHaveBeenCalled();
  });

  it('ignores voice from non-approved chat', async () => {
    const { service, voiceService } = buildService({
      adminChatId: 999,
      approval: { getStatus: vi.fn().mockResolvedValue('pending') },
    });
    const ctx = makeVoiceCtx({ chatId: 2 });

    await service.handleVoiceMessage(ctx);

    expect(voiceService.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues voice message from approved non-admin chat', async () => {
    const { service, voiceService } = buildService({ adminChatId: 999 });
    const ctx = makeVoiceCtx({
      chatId: 2,
      fileId: 'voice-file',
      duration: 10,
      messageId: 55,
    });

    await service.handleVoiceMessage(ctx);

    expect(voiceService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 2,
        telegramFileId: 'voice-file',
        durationSeconds: 10,
        telegramMessageId: 55,
      })
    );
  });

  it('does not call behaviorPipeline from voice handler', async () => {
    const { service, behaviorPipeline } = buildService({ adminChatId: 999 });
    const ctx = makeVoiceCtx({ chatId: 2 });

    await service.handleVoiceMessage(ctx);

    expect(behaviorPipeline.handleStoredMessage).not.toHaveBeenCalled();
  });
});
