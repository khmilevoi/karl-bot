import assert from 'node:assert';

import { type Bot, InlineKeyboard, InputFile } from 'grammy';
import { inject, injectable, LazyServiceIdentifier } from 'inversify';

import {
  BEHAVIOR_PIPELINE_ID,
  type BehaviorPipeline,
} from '@/application/behavior/BehaviorPipeline';
import type {
  DirectBehaviorTrigger,
  StoredBehaviorMessage,
} from '@/application/behavior/BehaviorTypes';
import {
  STATE_EVOLUTION_SCHEDULER_ID,
  type StateEvolutionScheduler,
} from '@/application/behavior/StateEvolutionScheduler';
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
import type { ChatMessenger } from '@/application/interfaces/chat/ChatMessenger';
import { CHAT_MESSENGER_ID } from '@/application/interfaces/chat/ChatMessenger';
import type { ChatResetService } from '@/application/interfaces/chat/ChatResetService';
import { CHAT_RESET_SERVICE_ID } from '@/application/interfaces/chat/ChatResetService';
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
  MESSAGE_SERVICE_ID,
  type MessageService,
} from '@/application/interfaces/messages/MessageService';
import {
  TOPIC_OF_DAY_SCHEDULER_ID,
  type TopicOfDayScheduler,
} from '@/application/interfaces/scheduler/TopicOfDayScheduler';
import {
  VOICE_MESSAGE_SERVICE_ID,
  type VoiceMessageService,
} from '@/application/interfaces/voice/VoiceMessageService';
import { MessageFactory } from '@/application/use-cases/messages/MessageFactory';
import type { TriggerContext, TriggerResult } from '@/domain/triggers/Trigger';

import type { BotContext } from './context';
import { type Actions, setupBotRouting } from './routes';

@injectable()
export class MainService {
  private readonly bot: Bot<BotContext>;
  private env: Env;
  private readonly logger: Logger;
  private readonly messenger: ChatMessenger;
  private readonly scheduler: TopicOfDayScheduler;
  private readonly stateEvolutionScheduler: StateEvolutionScheduler;

  constructor(
    @inject(ENV_SERVICE_ID) envService: EnvService,
    @inject(CHAT_RESET_SERVICE_ID) private resetService: ChatResetService,
    @inject(ADMIN_SERVICE_ID) private admin: AdminService,
    @inject(CHAT_APPROVAL_SERVICE_ID)
    private approvalService: ChatApprovalService,
    @inject(MESSAGE_CONTEXT_EXTRACTOR_ID)
    private extractor: MessageContextExtractor,
    @inject(TRIGGER_PIPELINE_ID) private pipeline: TriggerPipeline,
    @inject(MESSAGE_SERVICE_ID) private messages: MessageService,
    @inject(BEHAVIOR_PIPELINE_ID)
    private behaviorPipeline: BehaviorPipeline,
    @inject(CHAT_INFO_SERVICE_ID) private chatInfo: ChatInfoService,
    @inject(CHAT_CONFIG_SERVICE_ID) private chatConfig: ChatConfigService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory,
    @inject(new LazyServiceIdentifier(() => TOPIC_OF_DAY_SCHEDULER_ID))
    scheduler: TopicOfDayScheduler,
    @inject(new LazyServiceIdentifier(() => STATE_EVOLUTION_SCHEDULER_ID))
    stateEvolutionScheduler: StateEvolutionScheduler,
    @inject(CHAT_MESSENGER_ID)
    messenger: ChatMessenger,
    @inject(VOICE_MESSAGE_SERVICE_ID)
    private voiceMessageService: VoiceMessageService
  ) {
    this.env = envService.env;
    this.messenger = messenger;
    this.bot = messenger.bot as unknown as Bot<BotContext>;
    this.scheduler = scheduler;
    this.stateEvolutionScheduler = stateEvolutionScheduler;
    this.logger = loggerFactory.create('MainService');
    this.logger.info(
      { ADMIN_CHAT_ID: this.env.ADMIN_CHAT_ID },
      '[INIT] MainService initialized with ADMIN_CHAT_ID'
    );
    const actions: Actions = {
      exportData: (ctx: BotContext, menuMessageId: number) =>
        this.handleExportData(ctx, menuMessageId),
      resetMemory: (ctx: BotContext) => this.handleResetMemory(ctx),
      requestChatAccess: (ctx: BotContext) => this.handleChatRequest(ctx),
      requestUserAccess: (ctx: BotContext) => this.handleRequestAccess(ctx),
      sendUserNotification: (
        chatId: number,
        text: string,
        messageIdToDelete?: number
      ) => this.sendUserNotification(chatId, text, messageIdToDelete),
      getChats: () => this.getChats(),
      getChatData: (chatId: number) => this.getChatData(chatId),
      sendChatApprovalRequest: (chatId: number, title?: string) =>
        this.sendChatApprovalRequest(chatId, title),
      approveChat: (chatId: number) => this.approvalService.approve(chatId),
      banChat: (chatId: number) => this.approvalService.ban(chatId),
      unbanChat: (chatId: number) => this.approvalService.unban(chatId),
      approveUser: (chatId: number, userId: number) =>
        this.admin.createAccessKey(chatId, userId),
      hasUserAccess: (chatId: number, userId: number) =>
        this.admin.hasAccess(chatId, userId),
      getChatConfig: (chatId: number) => this.chatConfig.getConfig(chatId),
      setHistoryLimit: (chatId: number, limit: number, _isAdmin: boolean) =>
        this.chatConfig.setHistoryLimit(chatId, limit),
      setTopicTime: (chatId: number, time: string, timezone: string) =>
        this.chatConfig.setTopicTime(chatId, time, timezone),
      checkChatStatus: (chatId: number) =>
        this.approvalService.getStatus(chatId),
      processMessage: (ctx: BotContext) => this.handleMessage(ctx),
      processVoiceMessage: (ctx: BotContext) => this.handleVoiceMessage(ctx),
      isAdmin: (chatId: number) => chatId === this.env.ADMIN_CHAT_ID,
      log: (level, message, data) => this.logger[level](data ?? {}, message),
    };
    setupBotRouting(this.bot, actions);
  }

  public async launch(): Promise<void> {
    try {
      this.stateEvolutionScheduler.start();
    } catch (error) {
      this.logger.error({ error }, 'Failed to start state evolution scheduler');
    }

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
    const keyboard = new InlineKeyboard()
      .text('✅ Одобрить', `approve_chat:${chatId}`)
      .text('🚫 Забанить', `ban_chat:${chatId}`);
    await this.messenger.sendMessage(
      this.env.ADMIN_CHAT_ID,
      `Запрос на доступ от чата: ${name}`,
      { reply_markup: keyboard }
    );
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
      topicTime: string | null;
      topicTimezone: string;
    };
  }> {
    const status = await this.approvalService.getStatus(chatId);
    const config = await this.chatConfig.getConfig(chatId);
    return { chatId, status, config };
  }

  private async handleChatRequest(ctx: BotContext): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(chatId, 'This is not a chat');
    const title = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined;
    this.logger.info({ chatId, title }, 'Chat access request received');
    await this.sendChatApprovalRequest(chatId, title);
    await ctx.reply('Запрос отправлен');
    this.logger.info({ chatId }, 'Chat access request sent to admin');
  }

  private async handleRequestAccess(
    ctx: BotContext
  ): Promise<{ chatId: number; userId: number; messageId: number }> {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    this.logger.info(
      { chatId, userId },
      '[REQUEST_ACCESS] handleRequestAccess called'
    );

    assert(chatId, 'This is not a chat');
    assert(userId, 'No user id');

    const firstName = ctx.from?.first_name;
    const lastName = ctx.from?.last_name;
    const username = ctx.from?.username;
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const usernamePart = username ? ` @${username}` : '';
    const msg = `Chat ${chatId} user ${userId} (${fullName}${usernamePart}) requests data access.`;

    const messageId =
      ctx.callbackQuery && 'message' in ctx.callbackQuery
        ? (ctx.callbackQuery.message?.message_id ?? 0)
        : 0;

    const keyboard = new InlineKeyboard()
      .text('✅ Дать доступ', `approve_user:${chatId}:${userId}`)
      .text('❌ Не давать', `deny_user:${chatId}`)
      .row()
      .text('🚫 Забанить чат', `ban_chat:${chatId}`);

    try {
      await this.messenger.sendMessage(this.env.ADMIN_CHAT_ID, msg, {
        reply_markup: keyboard,
      });
      this.logger.info('[REQUEST_ACCESS] Message sent successfully');
    } catch (error) {
      this.logger.error(
        { error },
        '[REQUEST_ACCESS] Failed to send message to admin'
      );
      throw error;
    }

    return { chatId, userId, messageId };
  }

  private async handleExportData(
    ctx: BotContext,
    menuMessageId: number
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    assert(chatId, 'This is not a chat');
    assert(userId, 'No user id');
    this.logger.info({ chatId, userId }, 'Export data requested');

    await ctx.answerCallbackQuery();

    const editProgress = async (text: string): Promise<void> => {
      if (!menuMessageId) return;
      try {
        await ctx.api.editMessageText(chatId, menuMessageId, text, {
          reply_markup: { inline_keyboard: [] },
        });
      } catch {
        // Message may have been deleted — ignore
      }
    };

    const deleteProgress = async (): Promise<void> => {
      if (!menuMessageId) return;
      try {
        await ctx.api.deleteMessage(chatId, menuMessageId);
      } catch {
        // ignore
      }
    };

    await editProgress('⏳ Подготовка данных...');

    try {
      const files =
        chatId === this.env.ADMIN_CHAT_ID
          ? await this.admin.exportTables()
          : await this.admin.exportChatData(chatId);

      if (files.length === 0) {
        this.logger.info({ chatId, userId }, 'No data to export');
        await deleteProgress();
        await ctx.reply('Нет данных для экспорта.');
        return;
      }

      const total = files.length;
      await editProgress(`📦 Загружено 0/${total}...`);

      for (let i = 0; i < files.length; i++) {
        await ctx.replyWithDocument(
          new InputFile(files[i].buffer, files[i].filename)
        );
        await editProgress(`📦 Загружено ${i + 1}/${total}...`);
        // Yield to the event loop so bulk document sends don't block other updates
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      await deleteProgress();
      await ctx.reply('✅ Загрузка данных завершена!');
      this.logger.info(
        { chatId, userId, tables: files.length },
        'Data export completed'
      );
    } catch (error) {
      this.logger.error({ error, chatId, userId }, 'Failed to export data');
      await deleteProgress();
      await ctx.reply('❌ Ошибка при загрузке данных.');
    }
  }

  private async handleResetMemory(
    ctx: BotContext
  ): Promise<'ok' | 'denied' | 'error'> {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    assert(chatId, 'This is not a chat');
    assert(userId, 'No user id');

    if (chatId !== this.env.ADMIN_CHAT_ID) {
      const allowed = await this.admin.hasAccess(chatId, userId);
      if (!allowed) {
        return 'denied';
      }
    }

    try {
      await this.resetService.reset(chatId);
      return 'ok';
    } catch (error) {
      this.logger.error({ error, chatId }, 'Failed to reset memory');
      return 'error';
    }
  }

  private async checkChatStatus(chatId: number): Promise<string> {
    return this.approvalService.getStatus(chatId);
  }

  private async sendUserNotification(
    chatId: number,
    text: string,
    messageIdToDelete?: number
  ): Promise<void> {
    this.logger.info(
      { chatId, text, messageIdToDelete },
      '[NOTIFICATION] sendUserNotification called'
    );

    if (messageIdToDelete) {
      try {
        await this.bot.api.deleteMessage(chatId, messageIdToDelete);
        this.logger.info(
          { chatId, messageIdToDelete },
          '[NOTIFICATION] Message deleted successfully'
        );
      } catch (error) {
        this.logger.warn(
          { error, chatId, messageIdToDelete },
          '[NOTIFICATION] Failed to delete message'
        );
      }
    }

    try {
      await this.messenger.sendMessage(chatId, text);
      this.logger.info(
        { chatId },
        '[NOTIFICATION] Notification sent successfully'
      );
    } catch (error) {
      this.logger.error(
        { error, chatId, text },
        '[NOTIFICATION] Failed to send notification'
      );
      throw error;
    }
  }

  private async handleMessage(ctx: BotContext): Promise<void> {
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
    const storedId = await this.messages.addMessage(userMsg);
    const storedMessage: StoredBehaviorMessage = {
      ...userMsg,
      id: storedId,
      chatId,
    };

    const context: TriggerContext = {
      text: `${userMsg.content};`,
      replyText: userMsg.replyText ?? '',
      chatId,
    };

    this.logger.debug({ chatId }, 'Checking triggers');
    const triggerResult = await this.pipeline.shouldRespond(ctx, context);
    const directTrigger = triggerResult
      ? this.toDirectBehaviorTrigger(triggerResult, storedMessage)
      : null;
    if (!directTrigger) {
      this.logger.debug({ chatId }, 'No direct trigger matched');
    }

    const result = await this.behaviorPipeline.handleStoredMessage({
      message: storedMessage,
      directTrigger,
    });
    this.logger.debug({ chatId, resultKind: result.kind }, 'Behavior handled');
  }

  public async handleVoiceMessage(ctx: BotContext): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(!!chatId, 'This is not a chat');

    if (chatId === this.env.ADMIN_CHAT_ID) {
      this.logger.debug({ chatId }, 'Ignoring voice message from admin chat');
      return;
    }

    const status = await this.checkChatStatus(chatId);
    if (status !== 'approved') {
      this.logger.debug(
        { chatId, status },
        'Voice message from non-approved chat ignored'
      );
      return;
    }

    const voice = ctx.message?.voice;
    if (!voice) {
      this.logger.debug({ chatId }, 'No voice data in context');
      return;
    }

    const telegramMessageId = ctx.message?.message_id ?? 0;
    const meta = this.extractor.extract(ctx);
    const chatTitle =
      ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined;

    const result = await this.voiceMessageService.enqueue({
      chatId,
      chatTitle,
      telegramMessageId,
      telegramFileId: voice.file_id,
      durationSeconds: voice.duration,
      user: {
        id: ctx.from?.id ?? 0,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        fullName: meta.fullName,
      },
      context: meta,
    });

    if (result.kind === 'queued') {
      this.logger.info({ chatId, jobId: result.jobId }, 'Voice message queued');
    } else {
      this.logger.warn(
        { chatId, reason: result.reason },
        'Voice message rejected'
      );
    }
  }

  private toDirectBehaviorTrigger(
    triggerResult: TriggerResult,
    message: StoredBehaviorMessage
  ): DirectBehaviorTrigger {
    return {
      reason: 'direct_trigger',
      why:
        triggerResult.reason?.why ??
        triggerResult.reason?.message ??
        'direct trigger matched',
      triggerMessageId: message.id,
      replyToTelegramMessageId:
        triggerResult.replyToMessageId ?? message.messageId ?? null,
    };
  }
}
