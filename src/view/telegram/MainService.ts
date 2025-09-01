import assert from 'node:assert';

import { inject, injectable, LazyServiceIdentifier } from 'inversify';
import type { Context, Telegraf } from 'telegraf';

import type { AdminService } from '@/application/interfaces/admin/AdminService';
import { ADMIN_SERVICE_ID } from '@/application/interfaces/admin/AdminService';
import type { ChatApprovalService } from '@/application/interfaces/chat/ChatApprovalService';
import { CHAT_APPROVAL_SERVICE_ID } from '@/application/interfaces/chat/ChatApprovalService';
import type { ChatConfigService } from '@/application/interfaces/chat/ChatConfigService';
import { CHAT_CONFIG_SERVICE_ID } from '@/application/interfaces/chat/ChatConfigService';
import {
  CHAT_INFO_SERVICE_ID,
  type ChatInfoService,
} from '@/application/interfaces/chat/ChatInfoService';
import type { ChatMemoryManager } from '@/application/interfaces/chat/ChatMemoryManager';
import { CHAT_MEMORY_MANAGER_ID } from '@/application/interfaces/chat/ChatMemoryManager';
import type { ChatMessenger } from '@/application/interfaces/chat/ChatMessenger';
import { CHAT_MESSENGER_ID } from '@/application/interfaces/chat/ChatMessenger';
import type { ChatResponder } from '@/application/interfaces/chat/ChatResponder';
import { CHAT_RESPONDER_ID } from '@/application/interfaces/chat/ChatResponder';
import type { TriggerPipeline } from '@/application/interfaces/chat/TriggerPipeline';
import { TRIGGER_PIPELINE_ID } from '@/application/interfaces/chat/TriggerPipeline';
import type { Env, EnvService } from '@/application/interfaces/env/EnvService';
import { ENV_SERVICE_ID } from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type { MessageContextExtractor } from '@/application/interfaces/messages/MessageContextExtractor';
import { MESSAGE_CONTEXT_EXTRACTOR_ID } from '@/application/interfaces/messages/MessageContextExtractor';
import {
  TOPIC_OF_DAY_SCHEDULER_ID,
  type TopicOfDayScheduler,
} from '@/application/interfaces/scheduler/TopicOfDayScheduler';
import { MessageFactory } from '@/application/use-cases/messages/MessageFactory';
import type { TriggerContext } from '@/domain/triggers/Trigger';

import type { RunningRouter } from './inline-router';
import { type Actions, setupBotRouting } from './routes';

async function withTyping(
  ctx: Context,
  fn: () => Promise<void>
): Promise<void> {
  await ctx.sendChatAction('typing');
  const chatId = ctx.chat?.id;

  const timer = setInterval(() => {
    if (chatId !== undefined) {
      ctx.telegram.sendChatAction(chatId, 'typing').catch(() => {});
    }
  }, 4000);

  try {
    await fn();
  } finally {
    clearInterval(timer);
  }
}

@injectable()
export class MainService {
  private readonly bot: Telegraf;
  private env: Env;
  private router: RunningRouter<Actions>;
  private readonly logger: Logger;
  private readonly messenger: ChatMessenger;
  private readonly scheduler: TopicOfDayScheduler;

  constructor(
    @inject(ENV_SERVICE_ID) envService: EnvService,
    @inject(CHAT_MEMORY_MANAGER_ID) private memories: ChatMemoryManager,
    @inject(ADMIN_SERVICE_ID) private admin: AdminService,
    @inject(CHAT_APPROVAL_SERVICE_ID)
    private approvalService: ChatApprovalService,
    @inject(MESSAGE_CONTEXT_EXTRACTOR_ID)
    private extractor: MessageContextExtractor,
    @inject(TRIGGER_PIPELINE_ID) private pipeline: TriggerPipeline,
    @inject(CHAT_RESPONDER_ID) private responder: ChatResponder,
    @inject(CHAT_INFO_SERVICE_ID) private chatInfo: ChatInfoService,
    @inject(CHAT_CONFIG_SERVICE_ID) private chatConfig: ChatConfigService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory,
    @inject(new LazyServiceIdentifier(() => TOPIC_OF_DAY_SCHEDULER_ID))
    scheduler: TopicOfDayScheduler,
    @inject(CHAT_MESSENGER_ID)
    messenger: ChatMessenger
  ) {
    this.env = envService.env;
    this.messenger = messenger;
    this.bot = messenger.bot;
    this.scheduler = scheduler;
    this.logger = loggerFactory.create('MainService');
    const actions: Actions = {
      exportData: (ctx: Context) => this.handleExportData(ctx),
      resetMemory: (ctx: Context) => this.handleResetMemory(ctx),
      requestChatAccess: (ctx: Context) => this.handleChatRequest(ctx),
      requestUserAccess: (ctx: Context) => this.handleRequestAccess(ctx),
      getChats: () => this.getChats(),
      getChatData: (chatId: number) => this.getChatData(chatId),
      sendChatApprovalRequest: (chatId: number, title?: string) =>
        this.sendChatApprovalRequest(chatId, title),
      approveChat: (chatId: number) => this.approvalService.approve(chatId),
      banChat: (chatId: number) => this.approvalService.ban(chatId),
      unbanChat: (chatId: number) => this.approvalService.unban(chatId),
      approveUser: (chatId: number, userId: number) =>
        this.admin.createAccessKey(userId, chatId),
      getChatConfig: (chatId: number) => this.chatConfig.getConfig(chatId),
      setHistoryLimit: (chatId: number, limit: number, _isAdmin: boolean) =>
        this.chatConfig.setHistoryLimit(chatId, limit),
      setInterestInterval: (
        chatId: number,
        interval: number,
        _isAdmin: boolean
      ) => this.chatConfig.setInterestInterval(chatId, interval),
      setTopicTime: (chatId: number, time: string, timezone: string) =>
        this.chatConfig.setTopicTime(chatId, time, timezone),
      checkChatStatus: (chatId: number) =>
        this.approvalService.getStatus(chatId),
      processMessage: (ctx: Context) => this.handleMessage(ctx),
      isAdmin: (userId: number) => userId === this.env.ADMIN_CHAT_ID,
    };
    this.router = setupBotRouting(this.bot, actions);
    this.configure();
  }

  public async launch(): Promise<void> {
    await Promise.all([
      this.messenger.launch().catch((error) => this.logger.error(error)),
      this.scheduler.start().catch((error) => this.logger.error(error)),
    ]);
  }

  public stop(reason: string): void {
    this.messenger.stop(reason);
  }

  public async sendChatApprovalRequest(
    chatId: number,
    title?: string
  ): Promise<void> {
    await this.approvalService.pending(chatId);
    const name = title ? `${title} (${chatId})` : `Chat ${chatId}`;

    // Отправляем уведомление администратору - навигация обрабатывается в роутере
    await this.messenger.sendMessage(
      this.env.ADMIN_CHAT_ID,
      `Запрос на доступ от чата: ${name}`
    );
  }

  private configure(): void {
    // Все команды и обработчики теперь в роутере (routes.ts)
  }

  private async getChats(): Promise<{ id: number; title: string }[]> {
    const chats = await this.approvalService.listAll();
    return Promise.all(
      chats.map(async ({ chatId }) => {
        const chat = await this.chatInfo.getChat(chatId);
        return { id: chatId, title: chat?.title ?? 'Без названия' };
      })
    );
  }

  private async getChatData(chatId: number): Promise<{
    chatId: number;
    status: string;
    config: {
      historyLimit: number;
      interestInterval: number;
      topicTime: string | null;
      topicTimezone: string;
    };
  }> {
    const status = await this.approvalService.getStatus(chatId);
    const config = await this.chatConfig.getConfig(chatId);
    return { chatId, status, config };
  }

  private async handleChatRequest(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(chatId, 'This is not a chat');
    const title = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined;
    this.logger.info({ chatId, title }, 'Chat access request received');
    await this.sendChatApprovalRequest(chatId, title);
    await ctx.reply('Запрос отправлен');
    this.logger.info({ chatId }, 'Chat access request sent to admin');
  }

  private async handleRequestAccess(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    assert(chatId, 'This is not a chat');
    assert(userId, 'No user id');
    const firstName = ctx.from?.first_name;
    const lastName = ctx.from?.last_name;
    const username = ctx.from?.username;
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const usernamePart = username ? ` @${username}` : '';
    const msg = `Chat ${chatId} user ${userId} (${fullName}${usernamePart}) requests data access.`;

    // Отправляем уведомление администратору
    await this.messenger.sendMessage(this.env.ADMIN_CHAT_ID, msg);
    await ctx.reply('Запрос отправлен администратору.');
  }

  private async handleExportData(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    assert(chatId, 'This is not a chat');
    assert(userId, 'No user id');
    this.logger.info({ chatId, userId }, 'Export data requested');

    if (chatId !== this.env.ADMIN_CHAT_ID) {
      const allowed = await this.admin.hasAccess(chatId, userId);
      if (!allowed) {
        this.logger.warn({ chatId, userId }, 'Export data access denied');
        await ctx.answerCbQuery('Нет доступа или ключ просрочен');
        return;
      }
    }

    await ctx.answerCbQuery('Начинаю загрузку данных...');

    try {
      const files =
        chatId === this.env.ADMIN_CHAT_ID
          ? await this.admin.exportTables()
          : await this.admin.exportChatData(chatId);
      if (files.length === 0) {
        this.logger.info({ chatId, userId }, 'No data to export');
        await ctx.reply('Нет данных для экспорта');
        return;
      }

      await ctx.reply(
        `Найдено ${files.length} таблиц для экспорта. Начинаю загрузку...`
      );

      for (const f of files) {
        await ctx.replyWithDocument({
          source: f.buffer,
          filename: f.filename,
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      await ctx.reply('✅ Загрузка данных завершена!');
      this.logger.info(
        { chatId, userId, tables: files.length },
        'Data export completed'
      );
    } catch (error) {
      this.logger.error({ error, chatId, userId }, 'Failed to export data');
      await ctx.reply('❌ Ошибка при загрузке данных. Попробуйте позже.');
    }
  }

  private async handleResetMemory(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    assert(chatId, 'This is not a chat');
    assert(userId, 'No user id');

    if (chatId !== this.env.ADMIN_CHAT_ID) {
      const allowed = await this.admin.hasAccess(chatId, userId);
      if (!allowed) {
        await ctx.answerCbQuery('Нет доступа или ключ просрочен');
        return;
      }
    }

    await ctx.answerCbQuery('Сбрасываю память диалога...');

    try {
      await this.memories.reset(chatId);
      await ctx.reply('✅ Контекст диалога сброшен!');
    } catch (error) {
      this.logger.error({ error, chatId }, 'Failed to reset memory');
      await ctx.reply('❌ Ошибка при сбросе памяти. Попробуйте позже.');
    }
  }

  private async checkChatStatus(chatId: number): Promise<string> {
    return this.approvalService.getStatus(chatId);
  }

  private async handleMessage(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(!!chatId, 'This is not a chat');

    if (chatId === this.env.ADMIN_CHAT_ID) {
      this.logger.debug({ chatId }, 'Ignoring admin chat message');
      return;
    }

    this.logger.debug({ chatId }, 'Received text message');
    const status = await this.checkChatStatus(chatId);
    if (status !== 'approved') {
      this.logger.debug(
        { chatId, status },
        'Message from non-approved chat ignored'
      );
      return;
    }

    const meta = this.extractor.extract(ctx);
    const userMsg = MessageFactory.fromUser(ctx, meta);
    const memory = await this.memories.get(chatId);
    await memory.addMessage(userMsg);

    const context: TriggerContext = {
      text: `${userMsg.content};`,
      replyText: userMsg.replyText ?? '',
      chatId,
    };

    this.logger.debug({ chatId }, 'Checking triggers');
    const triggerResult = await this.pipeline.shouldRespond(ctx, context);
    if (!triggerResult) {
      this.logger.debug({ chatId }, 'No trigger matched');
      return;
    }

    await withTyping(ctx, async () => {
      this.logger.debug({ chatId }, 'Generating answer');
      const answer = await this.responder.generate(
        ctx,
        chatId,
        triggerResult.reason ?? undefined
      );
      this.logger.debug({ chatId }, 'Answer generated');

      const replyId = triggerResult.replyToMessageId ?? userMsg.messageId;
      ctx.reply(answer, {
        reply_parameters: replyId ? { message_id: replyId } : undefined,
      });
      this.logger.debug({ chatId }, 'Reply sent');
    });
  }
}
