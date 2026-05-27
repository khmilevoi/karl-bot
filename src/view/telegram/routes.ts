import assert from 'node:assert';

import { type Conversation, createConversation } from '@grammyjs/conversations';
import { Menu } from '@grammyjs/menu';
import type { Bot } from 'grammy';

import type { BotContext } from './context';

// ─── Actions interface ────────────────────────────────────────────────────────

export interface Actions {
  exportData: (ctx: BotContext) => Promise<void>;
  resetMemory: (ctx: BotContext) => Promise<void>;

  getChats: () => Promise<{ id: number; title: string }[]>;
  getChatData: (chatId: number) => Promise<{
    chatId: number;
    status: string;
    config: {
      historyLimit: number;
      interestInterval: number;
      topicTime: string | null;
      topicTimezone: string;
    };
  }>;
  requestChatAccess: (ctx: BotContext) => Promise<void>;
  requestUserAccess: (
    ctx: BotContext
  ) => Promise<{ chatId: number; userId: number; messageId: number }>;
  sendChatApprovalRequest: (chatId: number, title?: string) => Promise<void>;
  sendUserNotification: (
    chatId: number,
    text: string,
    messageIdToDelete?: number
  ) => Promise<void>;

  approveChat: (chatId: number) => Promise<void>;
  banChat: (chatId: number) => Promise<void>;
  unbanChat: (chatId: number) => Promise<void>;
  approveUser: (chatId: number, userId: number) => Promise<Date>;
  hasUserAccess: (chatId: number, userId: number) => Promise<boolean>;

  getChatConfig: (chatId: number) => Promise<{
    historyLimit: number;
    interestInterval: number;
    topicTime: string | null;
    topicTimezone: string;
  }>;
  setHistoryLimit: (
    chatId: number,
    limit: number,
    isAdmin: boolean
  ) => Promise<void>;
  setInterestInterval: (
    chatId: number,
    interval: number,
    isAdmin: boolean
  ) => Promise<void>;
  setTopicTime: (
    chatId: number,
    time: string,
    timezone: string
  ) => Promise<void>;

  checkChatStatus: (chatId: number) => Promise<string>;
  processMessage: (ctx: BotContext) => Promise<void>;
  isAdmin: (userId: number) => boolean;

  log: (
    level: 'info' | 'debug' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
  ) => void;
}

// ─── Conversation helpers ─────────────────────────────────────────────────────

type BotConversation = Conversation<BotContext, BotContext>;

function makeConversations(
  actions: Actions
): Record<
  string,
  (conversation: BotConversation, ctx: BotContext) => Promise<void>
> {
  async function adminHistoryLimit(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const chatId = await conversation.external(
      (ctx) => ctx.session?.selectedChatId
    );
    assert(chatId, 'No selected chat');
    await ctx.reply(
      `Введите новый лимит истории для чата ${chatId} (от 1 до 50):`
    );
    const next = await conversation.waitFor('message:text');
    const limit = parseInt(next.message.text, 10);
    if (isNaN(limit) || limit < 1 || limit > 50) {
      await ctx.api.sendMessage(chatId, 'Некорректное значение (1–50).');
      return;
    }
    await actions.setHistoryLimit(chatId, limit, true);
    await ctx.api.sendMessage(chatId, '✅ Лимит установлен');
  }

  async function adminInterestInterval(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const chatId = await conversation.external(
      (ctx) => ctx.session?.selectedChatId
    );
    assert(chatId, 'No selected chat');
    await ctx.reply(
      `Введите новый интервал интереса для чата ${chatId} (от 1 до 50):`
    );
    const next = await conversation.waitFor('message:text');
    const interval = parseInt(next.message.text, 10);
    if (isNaN(interval) || interval < 1 || interval > 50) {
      await ctx.api.sendMessage(chatId, 'Некорректное значение (1–50).');
      return;
    }
    await actions.setInterestInterval(chatId, interval, true);
    await ctx.api.sendMessage(chatId, '✅ Интервал установлен');
  }

  async function adminTopicTime(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const chatId = await conversation.external(
      () => ctx.session?.selectedChatId
    );
    assert(chatId, 'No selected chat');
    await ctx.reply(
      `Введите время темы дня для чата ${chatId} (формат HH:MM):`
    );
    const timeNext = await conversation.waitFor('message:text');
    const time = timeNext.message.text.trim();
    await ctx.api.sendMessage(
      chatId,
      `Введите часовой пояс (например UTC+03):`
    );
    const tzNext = await conversation.waitFor('message:text');
    const timezone = tzNext.message.text.trim();
    await actions.setTopicTime(chatId, time, timezone);
    await ctx.api.sendMessage(
      chatId,
      `✅ Время ${time} (${timezone}) установлено`
    );
  }

  async function userHistoryLimit(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(chatId, 'No chat id');
    await ctx.reply('Введите новый лимит истории (от 1 до 50):');
    const next = await conversation.waitFor('message:text');
    const limit = parseInt(next.message.text, 10);
    if (isNaN(limit) || limit < 1 || limit > 50) {
      await ctx.reply('Некорректное значение (1–50).');
      return;
    }
    await actions.setHistoryLimit(chatId, limit, false);
    await ctx.reply('✅ Лимит установлен');
  }

  async function userInterestInterval(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(chatId, 'No chat id');
    await ctx.reply('Введите новый интервал интереса (от 1 до 50):');
    const next = await conversation.waitFor('message:text');
    const interval = parseInt(next.message.text, 10);
    if (isNaN(interval) || interval < 1 || interval > 50) {
      await ctx.reply('Некорректное значение (1–50).');
      return;
    }
    await actions.setInterestInterval(chatId, interval, false);
    await ctx.reply('✅ Интервал установлен');
  }

  async function userTopicTime(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(chatId, 'No chat id');
    await ctx.reply('Введите время темы дня (формат HH:MM):');
    const timeNext = await conversation.waitFor('message:text');
    const time = timeNext.message.text.trim();
    await ctx.reply('Введите часовой пояс (например UTC+03):');
    const tzNext = await conversation.waitFor('message:text');
    const timezone = tzNext.message.text.trim();
    await actions.setTopicTime(chatId, time, timezone);
    await ctx.reply(`✅ Время ${time} (${timezone}) установлено`);
  }

  return {
    adminHistoryLimit,
    adminInterestInterval,
    adminTopicTime,
    userHistoryLimit,
    userInterestInterval,
    userTopicTime,
  };
}

// ─── Menu builders ────────────────────────────────────────────────────────────

function buildMenus(actions: Actions): {
  adminMenu: Menu<BotContext>;
  userMenu: Menu<BotContext>;
  chatNotApprovedMenu: Menu<BotContext>;
} {
  // ── Admin menus ───

  const adminChat = new Menu<BotContext>('admin_chat')
    .dynamic(async (ctx, range) => {
      const chatId = ctx.session.selectedChatId;
      if (!chatId) return;
      const data = await actions.getChatData(chatId);
      const { status, config } = data;

      range.text('📝 Лимит истории', async (ctx) => {
        await ctx.conversation.enter('adminHistoryLimit');
      });
      range.row();
      range.text('🎯 Интервал интереса', async (ctx) => {
        await ctx.conversation.enter('adminInterestInterval');
      });
      range.row();
      range.text('📅 Время темы дня', async (ctx) => {
        await ctx.conversation.enter('adminTopicTime');
      });
      range.row();

      if (status === 'approved') {
        range.text('🚫 Заблокировать', async (ctx) => {
          await actions.banChat(chatId);
          await ctx.answerCallbackQuery('Чат заблокирован');
          ctx.menu.update();
        });
      } else if (status === 'banned') {
        range.text('✅ Разблокировать', async (ctx) => {
          await actions.unbanChat(chatId);
          await ctx.answerCallbackQuery('Чат разблокирован');
          ctx.menu.update();
        });
      }

      range.row();
      range.text(
        `История: ${config.historyLimit} | Интервал: ${config.interestInterval}`,
        async (ctx) => {
          await ctx.answerCallbackQuery();
        }
      );
    })
    .row()
    .back('← Назад');

  const adminChats = new Menu<BotContext>('admin_chats')
    .dynamic(async (ctx, range) => {
      const chats = await actions.getChats();
      if (chats.length === 0) {
        range.text('Нет доступных чатов', async (ctx) => {
          await ctx.answerCallbackQuery();
        });
        return;
      }
      for (const chat of chats) {
        range.text(`${chat.title} (${chat.id})`, async (ctx) => {
          ctx.session.selectedChatId = chat.id;
          await ctx.menu.nav('admin_chat');
        });
        range.row();
      }
    })
    .row()
    .back('← Назад');

  const adminMenu = new Menu<BotContext>('admin_menu')
    .text('📊 Загрузить данные', async (ctx) => {
      await actions.exportData(ctx);
    })
    .row()
    .submenu('💬 Управление чатами', 'admin_chats');

  adminChats.register(adminChat);
  adminMenu.register(adminChats);

  // ── User menus ───

  const chatSettings = new Menu<BotContext>('chat_settings')
    .text('📝 Лимит истории', async (ctx) => {
      await ctx.conversation.enter('userHistoryLimit');
    })
    .row()
    .text('🎯 Интервал интереса', async (ctx) => {
      await ctx.conversation.enter('userInterestInterval');
    })
    .row()
    .text('📅 Время темы дня', async (ctx) => {
      await ctx.conversation.enter('userTopicTime');
    })
    .row()
    .back('← Назад');

  const requestDataAccessMenu = new Menu<BotContext>('request_data_access')
    .text('📝 Запросить доступ', async (ctx) => {
      actions.log('info', '[REQUEST_ACCESS] Button clicked');
      const result = await actions.requestUserAccess(ctx);
      actions.log('info', '[REQUEST_ACCESS] Request sent', result);
      await ctx.deleteMessage();
      await ctx.answerCallbackQuery('Запрос отправлен администратору');
    })
    .row()
    .text('❌ Отмена', async (ctx) => {
      await ctx.deleteMessage();
      await ctx.answerCallbackQuery('Отменено');
    });

  const userMenu = new Menu<BotContext>('user_menu')
    .text('📊 Загрузить данные', async (ctx) => {
      const chatId = ctx.chat?.id;
      const userId = ctx.from?.id;
      if (!chatId || !userId) {
        await ctx.answerCallbackQuery(
          'Ошибка: не удалось определить чат или пользователя'
        );
        return;
      }
      const isAdminChat = actions.isAdmin(chatId);
      const hasAccess =
        isAdminChat || (await actions.hasUserAccess(chatId, userId));
      if (!hasAccess) {
        await ctx.reply(
          '❌ У вас нет доступа к данным этого чата.\n\nДля получения доступа обратитесь к администратору.',
          { reply_markup: requestDataAccessMenu }
        );
        return;
      }
      await actions.exportData(ctx);
    })
    .row()
    .text('🔄 Сбросить память', async (ctx) => {
      await actions.resetMemory(ctx);
    })
    .row()
    .submenu('⚙️ Настройки чата', 'chat_settings');

  userMenu.register([chatSettings, requestDataAccessMenu]);

  // ── Standalone menus ───

  const chatNotApprovedMenu = new Menu<BotContext>('chat_not_approved').text(
    '📝 Запросить доступ',
    async (ctx) => {
      await actions.requestChatAccess(ctx);
    }
  );

  return { adminMenu, userMenu, chatNotApprovedMenu };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setupBotRouting(bot: Bot<BotContext>, actions: Actions): void {
  // Register conversation handlers (must come before menus and command handlers)
  const convs = makeConversations(actions);
  bot.use(createConversation(convs.adminHistoryLimit));
  bot.use(createConversation(convs.adminInterestInterval));
  bot.use(createConversation(convs.adminTopicTime));
  bot.use(createConversation(convs.userHistoryLimit));
  bot.use(createConversation(convs.userInterestInterval));
  bot.use(createConversation(convs.userTopicTime));

  // Build and register menus
  const { adminMenu, userMenu, chatNotApprovedMenu } = buildMenus(actions);
  bot.use(adminMenu);
  bot.use(userMenu);
  bot.use(chatNotApprovedMenu);

  // Commands
  bot.command(['start', 'menu'], async (ctx) => {
    if (actions.isAdmin(ctx.chat?.id ?? 0)) {
      await ctx.reply('Панель администратора\nВыберите действие:', {
        reply_markup: adminMenu,
      });
    } else {
      await ctx.reply('Главное меню\nВыберите действие:', {
        reply_markup: userMenu,
      });
    }
  });

  // New chat member — check approval status
  bot.on('my_chat_member', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const status = await actions.checkChatStatus(chatId);
    if (status !== 'approved') {
      await ctx.reply('Этот чат не находится в списке разрешённых.', {
        reply_markup: chatNotApprovedMenu,
      });
    }
  });

  // Text messages — trigger pipeline
  bot.on('message:text', async (ctx) => {
    await actions.processMessage(ctx);
  });
}
