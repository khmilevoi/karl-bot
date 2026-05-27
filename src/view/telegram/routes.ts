import assert from 'node:assert';

import { type Conversation, createConversation } from '@grammyjs/conversations';
import { Menu } from '@grammyjs/menu';
import { type Bot, InlineKeyboard } from 'grammy';

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
  isAdmin: (chatId: number) => boolean;

  log: (
    level: 'info' | 'debug' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
  ) => void;
}

// ─── Conversation helpers ─────────────────────────────────────────────────────

type BotConversation = Conversation<BotContext, BotContext>;

interface InputResult<T> {
  value: T;
  userMessageId: number;
  promptMessageId: number;
}

const CANCEL_DATA = 'cancel_conversation';

const cancelKeyboard = new InlineKeyboard().text('❌ Отмена', CANCEL_DATA);

async function tryDeleteMessage(
  ctx: BotContext,
  chatId: number,
  messageId: number
): Promise<void> {
  try {
    await ctx.api.deleteMessage(chatId, messageId);
  } catch {
    // Bot may lack admin rights — ignore
  }
}

async function waitForInputOrCancel<T>(
  conversation: BotConversation,
  ctx: BotContext,
  promptText: string,
  validator: (text: string) => T | null
): Promise<InputResult<T> | null> {
  const chatId = ctx.chat?.id;
  assert(chatId, 'No chat id');

  let retries = 0;

  while (retries < 2) {
    const promptMsg = await ctx.api.sendMessage(chatId, promptText, {
      reply_markup: cancelKeyboard,
    });

    const update = await conversation.waitUntil(
      (ctx) => ctx.hasCallbackQuery(CANCEL_DATA) || ctx.has('message:text')
    );

    if (update.callbackQuery?.data === CANCEL_DATA) {
      await update.answerCallbackQuery('Отменено');
      await tryDeleteMessage(ctx, chatId, promptMsg.message_id);
      return null;
    }

    const text = update.message?.text ?? '';
    const userMessageId = update.message?.message_id ?? 0;
    const result = validator(text);

    if (result !== null) {
      await tryDeleteMessage(ctx, chatId, promptMsg.message_id);
      await tryDeleteMessage(ctx, chatId, userMessageId);
      return {
        value: result,
        userMessageId,
        promptMessageId: promptMsg.message_id,
      };
    }

    await tryDeleteMessage(ctx, chatId, promptMsg.message_id);
    await tryDeleteMessage(ctx, chatId, userMessageId);
    retries++;

    if (retries >= 2) {
      await ctx.api.sendMessage(
        chatId,
        'Слишком много попыток. Возвращаюсь в меню.'
      );
      return null;
    }

    promptText = `Некорректное значение. ${promptText}`;
  }

  return null;
}

// ─── Menu ref type ────────────────────────────────────────────────────────────

type MenuRef = { menu: Menu<BotContext>; title: string };

function makeConversations(
  actions: Actions,
  menuRefs: {
    userMenu: MenuRef;
    adminMenu: MenuRef;
    chatSettings: MenuRef;
    adminChat: MenuRef;
  }
): Record<
  string,
  (conversation: BotConversation, ctx: BotContext) => Promise<void>
> {
  async function adminHistoryLimit(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const adminChatId = ctx.chat?.id;
    assert(adminChatId, 'No chat id');
    const chatId = await conversation.external(
      (ctx) => ctx.session?.selectedChatId
    );
    assert(chatId, 'No selected chat');

    const result = await waitForInputOrCancel(
      conversation,
      ctx,
      `Введите новый лимит истории для чата ${chatId} (от 1 до 50):`,
      (text) => {
        const n = parseInt(text, 10);
        return !isNaN(n) && n >= 1 && n <= 50 ? n : null;
      }
    );

    if (result === null) return;

    await actions.setHistoryLimit(chatId, result.value, true);
    await ctx.api.sendMessage(adminChatId, '✅ Лимит установлен', {
      reply_markup: menuRefs.adminChat.menu,
    });
  }

  async function adminInterestInterval(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const adminChatId = ctx.chat?.id;
    assert(adminChatId, 'No chat id');
    const chatId = await conversation.external(
      (ctx) => ctx.session?.selectedChatId
    );
    assert(chatId, 'No selected chat');

    const result = await waitForInputOrCancel(
      conversation,
      ctx,
      `Введите новый интервал интереса для чата ${chatId} (от 1 до 50):`,
      (text) => {
        const n = parseInt(text, 10);
        return !isNaN(n) && n >= 1 && n <= 50 ? n : null;
      }
    );

    if (result === null) return;

    await actions.setInterestInterval(chatId, result.value, true);
    await ctx.api.sendMessage(adminChatId, '✅ Интервал установлен', {
      reply_markup: menuRefs.adminChat.menu,
    });
  }

  async function adminTopicTime(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const adminChatId = ctx.chat?.id;
    assert(adminChatId, 'No chat id');
    const chatId = await conversation.external(
      () => ctx.session?.selectedChatId
    );
    assert(chatId, 'No selected chat');

    const timeResult = await waitForInputOrCancel(
      conversation,
      ctx,
      `Введите время темы дня для чата ${chatId} (формат HH:MM):`,
      (text) => {
        const trimmed = text.trim();
        return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : null;
      }
    );

    if (timeResult === null) return;

    const tzResult = await waitForInputOrCancel(
      conversation,
      ctx,
      'Введите часовой пояс (например UTC+03):',
      (text) => {
        const trimmed = text.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    );

    if (tzResult === null) return;

    await actions.setTopicTime(chatId, timeResult.value, tzResult.value);
    await ctx.api.sendMessage(
      adminChatId,
      `✅ Время ${timeResult.value} (${tzResult.value}) установлено`,
      { reply_markup: menuRefs.adminChat.menu }
    );
  }

  async function userHistoryLimit(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(chatId, 'No chat id');

    const result = await waitForInputOrCancel(
      conversation,
      ctx,
      'Введите новый лимит истории (от 1 до 50):',
      (text) => {
        const n = parseInt(text, 10);
        return !isNaN(n) && n >= 1 && n <= 50 ? n : null;
      }
    );

    if (result === null) return;

    await actions.setHistoryLimit(chatId, result.value, false);
    await ctx.api.sendMessage(chatId, '✅ Лимит установлен', {
      reply_markup: menuRefs.chatSettings.menu,
    });
  }

  async function userInterestInterval(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(chatId, 'No chat id');

    const result = await waitForInputOrCancel(
      conversation,
      ctx,
      'Введите новый интервал интереса (от 1 до 50):',
      (text) => {
        const n = parseInt(text, 10);
        return !isNaN(n) && n >= 1 && n <= 50 ? n : null;
      }
    );

    if (result === null) return;

    await actions.setInterestInterval(chatId, result.value, false);
    await ctx.api.sendMessage(chatId, '✅ Интервал установлен', {
      reply_markup: menuRefs.chatSettings.menu,
    });
  }

  async function userTopicTime(
    conversation: BotConversation,
    ctx: BotContext
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    assert(chatId, 'No chat id');

    const timeResult = await waitForInputOrCancel(
      conversation,
      ctx,
      'Введите время темы дня (формат HH:MM):',
      (text) => {
        const trimmed = text.trim();
        return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : null;
      }
    );

    if (timeResult === null) return;

    const tzResult = await waitForInputOrCancel(
      conversation,
      ctx,
      'Введите часовой пояс (например UTC+03):',
      (text) => {
        const trimmed = text.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    );

    if (tzResult === null) return;

    await actions.setTopicTime(chatId, timeResult.value, tzResult.value);
    await ctx.api.sendMessage(
      chatId,
      `✅ Время ${timeResult.value} (${tzResult.value}) установлено`,
      { reply_markup: menuRefs.chatSettings.menu }
    );
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
  chatSettings: Menu<BotContext>;
  adminChat: Menu<BotContext>;
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

  return { adminMenu, userMenu, chatNotApprovedMenu, chatSettings, adminChat };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setupBotRouting(bot: Bot<BotContext>, actions: Actions): void {
  // Build menus first (conversations need menu refs)
  const { adminMenu, userMenu, chatNotApprovedMenu, chatSettings, adminChat } =
    buildMenus(actions);

  const menuRefs = {
    userMenu: { menu: userMenu, title: 'Главное меню\nВыберите действие:' },
    adminMenu: {
      menu: adminMenu,
      title: 'Панель администратора\nВыберите действие:',
    },
    chatSettings: { menu: chatSettings, title: 'Настройки чата:' },
    adminChat: { menu: adminChat, title: 'Управление чатом:' },
  };

  // Register conversation handlers (must come before menus and command handlers)
  const convs = makeConversations(actions, menuRefs);
  bot.use(createConversation(convs.adminHistoryLimit));
  bot.use(createConversation(convs.adminInterestInterval));
  bot.use(createConversation(convs.adminTopicTime));
  bot.use(createConversation(convs.userHistoryLimit));
  bot.use(createConversation(convs.userInterestInterval));
  bot.use(createConversation(convs.userTopicTime));

  // Register menus
  bot.use(adminMenu);
  bot.use(userMenu);
  bot.use(chatNotApprovedMenu);

  // Commands
  bot.command(['start', 'menu'], async (ctx) => {
    if (actions.isAdmin(ctx.chat?.id ?? 0)) {
      await ctx.reply(menuRefs.adminMenu.title, {
        reply_markup: adminMenu,
      });
    } else {
      await ctx.reply(menuRefs.userMenu.title, {
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
