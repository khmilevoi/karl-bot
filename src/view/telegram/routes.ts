import assert from 'node:assert';

import { type Conversation, createConversation } from '@grammyjs/conversations';
import { Menu } from '@grammyjs/menu';
import { type Bot, InlineKeyboard } from 'grammy';

import type { BotContext } from './context';

export const ADMIN_MENU_TITLE = 'Панель администратора\nВыберите действие:';
export const USER_MENU_TITLE = 'Главное меню\nВыберите действие:';

// ─── Actions interface ────────────────────────────────────────────────────────

export interface Actions {
  exportData: (ctx: BotContext, menuMessageId: number) => Promise<void>;
  resetMemory: (ctx: BotContext) => Promise<'ok' | 'denied' | 'error'>;

  getChats: () => Promise<{ id: number; title: string }[]>;
  getChatData: (chatId: number) => Promise<{
    chatId: number;
    status: string;
    config: {
      historyLimit: number;
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
  }>;
  setHistoryLimit: (
    chatId: number,
    limit: number,
    isAdmin: boolean
  ) => Promise<void>;
  checkChatStatus: (chatId: number) => Promise<string>;
  processMessage: (ctx: BotContext) => Promise<void>;
  processVoiceMessage: (ctx: BotContext) => Promise<void>;
  isAdmin: (chatId: number) => boolean;

  log: (
    level: 'info' | 'debug' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>
  ) => void;
}

// ─── Conversation helpers ─────────────────────────────────────────────────────

type BotConversation = Conversation<BotContext, BotContext>;

export const CANCEL_DATA = 'cancel_conversation';

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

export async function waitForInputOrCancel<T>(
  conversation: BotConversation,
  ctx: BotContext,
  promptText: string,
  validator: (text: string) => T | null
): Promise<T | null> {
  const chatId = ctx.chat?.id;
  assert(chatId, 'No chat id');

  let currentPrompt = promptText;

  for (let attempt = 0; attempt < 2; attempt++) {
    const promptMsg = await ctx.api.sendMessage(chatId, currentPrompt, {
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

    await tryDeleteMessage(ctx, chatId, promptMsg.message_id);
    await tryDeleteMessage(ctx, chatId, userMessageId);

    if (result !== null) {
      return result;
    }

    currentPrompt = `Некорректное значение. ${promptText}`;
  }

  await ctx.api.sendMessage(
    chatId,
    'Слишком много попыток. Возвращаюсь в меню.'
  );
  return null;
}

// ─── Menu ref type ────────────────────────────────────────────────────────────

type MenuRef = { menu: Menu<BotContext>; title: string };

export function makeConversations(
  actions: Actions,
  menuRefs: {
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

    await actions.setHistoryLimit(chatId, result, true);
    await ctx.api.sendMessage(adminChatId, '✅ Лимит установлен', {
      reply_markup: menuRefs.adminChat.menu,
    });
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

    await actions.setHistoryLimit(chatId, result, false);
    await ctx.api.sendMessage(chatId, '✅ Лимит установлен', {
      reply_markup: menuRefs.chatSettings.menu,
    });
  }

  return {
    adminHistoryLimit,
    userHistoryLimit,
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

  async function sendMainMenu(
    ctx: BotContext,
    titleOverride?: string
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const isAdminChat = actions.isAdmin(chatId);
    const title =
      titleOverride ?? (isAdminChat ? ADMIN_MENU_TITLE : USER_MENU_TITLE);
    await ctx.api.sendMessage(chatId, title, {
      reply_markup: isAdminChat ? adminMenu : userMenu,
    });
  }

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
      range.text(`История: ${config.historyLimit}`, async (ctx) => {
        await ctx.answerCallbackQuery();
      });
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
      await actions.exportData(
        ctx,
        ctx.callbackQuery?.message?.message_id ?? 0
      );
      await sendMainMenu(ctx);
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
    .back('← Назад');

  const resetTitles: Record<'ok' | 'denied' | 'error', string> = {
    ok: '✅ Память сброшена!',
    denied: '❌ Нет доступа или ключ просрочен.',
    error: '❌ Ошибка при сбросе памяти.',
  };

  const confirmReset = new Menu<BotContext>('confirm_reset')
    .text('✅ Да, сбросить', async (ctx) => {
      await ctx.editMessageText('⏳ Сбрасываю память...');
      const result = await actions.resetMemory(ctx);
      const chatId = ctx.chat?.id;
      const messageId = ctx.callbackQuery?.message?.message_id;
      if (chatId && messageId) {
        await tryDeleteMessage(ctx, chatId, messageId);
      }
      await sendMainMenu(ctx, resetTitles[result]);
    })
    .row()
    .back('❌ Отмена');

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
        const deniedText =
          '❌ У вас нет доступа к данным этого чата.\n\nДля получения доступа обратитесь к администратору.';
        try {
          await ctx.editMessageText(deniedText, {
            reply_markup: requestDataAccessMenu,
          });
        } catch {
          await ctx.reply(deniedText, { reply_markup: requestDataAccessMenu });
        }
        return;
      }
      await actions.exportData(
        ctx,
        ctx.callbackQuery?.message?.message_id ?? 0
      );
      await sendMainMenu(ctx);
    })
    .row()
    .submenu('🔄 Сбросить память', 'confirm_reset', async (ctx) => {
      await ctx.editMessageText(
        '⚠️ Вы уверены, что хотите сбросить память диалога? Это действие необратимо.'
      );
    })
    .row()
    .submenu('⚙️ Настройки чата', 'chat_settings');

  userMenu.register([chatSettings, confirmReset, requestDataAccessMenu]);

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
    userMenu: { menu: userMenu, title: USER_MENU_TITLE },
    adminMenu: { menu: adminMenu, title: ADMIN_MENU_TITLE },
    chatSettings: { menu: chatSettings, title: 'Настройки чата:' },
    adminChat: { menu: adminChat, title: 'Управление чатом:' },
  };

  // Register menus before conversations so their API transformer is active inside conversations
  bot.use(adminMenu);
  bot.use(userMenu);
  bot.use(chatNotApprovedMenu);

  // Register conversation handlers
  const convs = makeConversations(actions, menuRefs);
  bot.use(createConversation(convs.adminHistoryLimit));
  bot.use(createConversation(convs.userHistoryLimit));

  // Commands
  bot.command(['start', 'menu'], async (ctx) => {
    if (actions.isAdmin(ctx.chat?.id ?? 0)) {
      await ctx.reply(menuRefs.adminMenu.title, {
        reply_markup: adminMenu,
      });
    } else {
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      const status = await actions.checkChatStatus(chatId);

      if (status !== 'approved') {
        await ctx.reply('Этот чат не находится в списке разрешённых.', {
          reply_markup: chatNotApprovedMenu,
        });
      } else {
        await ctx.reply(menuRefs.userMenu.title, {
          reply_markup: userMenu,
        });
      }
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

  // Admin chat approval callbacks
  bot.callbackQuery(/^approve_chat:(-?\d+)$/, async (ctx) => {
    if (!actions.isAdmin(ctx.chat?.id ?? 0)) {
      await ctx.answerCallbackQuery('Not authorized');
      return;
    }
    const chatId = parseInt(ctx.match[1], 10);
    await actions.approveChat(chatId);
    await ctx.editMessageText(
      `${ctx.callbackQuery.message?.text ?? ''}\n\n✅ Одобрено`,
      { reply_markup: { inline_keyboard: [] } }
    );
    await ctx.answerCallbackQuery('Чат одобрен');
  });

  bot.callbackQuery(/^ban_chat:(-?\d+)$/, async (ctx) => {
    if (!actions.isAdmin(ctx.chat?.id ?? 0)) {
      await ctx.answerCallbackQuery('Not authorized');
      return;
    }
    const chatId = parseInt(ctx.match[1], 10);
    await actions.banChat(chatId);
    await ctx.editMessageText(
      `${ctx.callbackQuery.message?.text ?? ''}\n\n🚫 Заблокирован`,
      { reply_markup: { inline_keyboard: [] } }
    );
    await ctx.answerCallbackQuery('Чат заблокирован');
  });

  bot.callbackQuery(/^approve_user:(-?\d+):(\d+)$/, async (ctx) => {
    if (!actions.isAdmin(ctx.chat?.id ?? 0)) {
      await ctx.answerCallbackQuery('Not authorized');
      return;
    }
    const chatId = parseInt(ctx.match[1], 10);
    const userId = parseInt(ctx.match[2], 10);
    await actions.approveUser(chatId, userId);
    await actions.sendUserNotification(
      chatId,
      '✅ Ваш запрос на доступ к данным одобрен!'
    );
    await ctx.editMessageText(
      `${ctx.callbackQuery.message?.text ?? ''}\n\n✅ Доступ выдан`,
      { reply_markup: { inline_keyboard: [] } }
    );
    await ctx.answerCallbackQuery('Доступ выдан');
  });

  bot.callbackQuery(/^deny_user:(-?\d+)$/, async (ctx) => {
    if (!actions.isAdmin(ctx.chat?.id ?? 0)) {
      await ctx.answerCallbackQuery('Not authorized');
      return;
    }
    await ctx.editMessageText(
      `${ctx.callbackQuery.message?.text ?? ''}\n\n❌ Отклонено`,
      { reply_markup: { inline_keyboard: [] } }
    );
    await ctx.answerCallbackQuery('Отклонено');
  });

  // Text messages — trigger pipeline
  bot.on('message:text', async (ctx) => {
    await actions.processMessage(ctx);
  });

  // Voice messages
  bot.on('message:voice', async (ctx) => {
    await actions.processVoiceMessage(ctx);
  });
}
