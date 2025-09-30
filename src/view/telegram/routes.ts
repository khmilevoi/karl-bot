import type { Context, Telegraf } from 'telegraf';

import {
  branch,
  button,
  type ContextWithMatch,
  createRouter,
  type NavigateFn,
  type Route,
  route,
  type RunningRouter,
} from './inline-router';

// Actions интерфейс - только данные, никакой навигации
interface Actions {
  // Экспорт и память
  exportData: (ctx: Context) => Promise<void>;
  resetMemory: (ctx: Context) => Promise<void>;

  // Чаты и пользователи
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
  requestChatAccess: (ctx: Context) => Promise<void>;
  requestUserAccess: (ctx: Context) => Promise<void>;
  sendChatApprovalRequest: (chatId: number, title?: string) => Promise<void>;

  // Управление доступом
  approveChat: (chatId: number) => Promise<void>;
  banChat: (chatId: number) => Promise<void>;
  unbanChat: (chatId: number) => Promise<void>;
  approveUser: (chatId: number, userId: number) => Promise<Date>;

  // Конфигурация
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

  // Проверки и обработка сообщений
  checkChatStatus: (chatId: number) => Promise<string>;
  processMessage: (ctx: Context) => Promise<void>;
  isAdmin: (userId: number) => boolean;
}

export type { Actions };

// Основные роуты (имена с большой буквы)

// Главное меню - определяет админ это или пользователь и редиректит
const Menu = route<Actions>('menu', async ({ ctx, actions, navigate }) => {
  if (actions.isAdmin(ctx.from?.id ?? 0)) {
    return navigate(AdminMenu);
  }
  return navigate(UserMenu);
});

// Админское меню
const AdminMenu = route<Actions>('admin_menu', async () => ({
  text: 'Панель администратора\nВыберите действие:',
  buttons: [
    button({
      text: '📊 Загрузить данные',
      callback: 'admin_export',
      action: async ({ actions, ctx }) => {
        await actions.exportData(ctx);
      },
    }),
    button({
      text: '💬 Управление чатами',
      callback: 'admin_chats',
      action: ({ navigate }) => navigate(AdminChats),
    }),
  ],
}));

// Пользовательское меню
const UserMenu: Route<Actions> = route<Actions>('user_menu', async () => ({
  text: 'Главное меню\nВыберите действие:',
  buttons: [
    button({
      text: '📊 Загрузить данные',
      callback: 'export',
      action: async ({ actions, ctx }) => {
        await actions.exportData(ctx);
      },
    }),
    button({
      text: '🔄 Сбросить память',
      callback: 'reset',
      action: async ({ actions, ctx }) => {
        await actions.resetMemory(ctx);
      },
    }),
    button({
      text: '⚙️ Настройки чата',
      callback: 'settings',
      action: ({ navigate }) => navigate(ChatSettings),
    }),
  ],
}));

// Список чатов для админа
const AdminChats = route<Actions>('admin_chats', async ({ actions }) => {
  const chats = await actions.getChats();
  return {
    text:
      chats.length > 0 ? 'Выберите чат для управления:' : 'Нет доступных чатов',
    buttons: chats.map((chat) =>
      button({
        text: `${chat.title} (${chat.id})`,
        callback: `chat_${chat.id}`,
        action: ({ navigate }) => navigate(AdminChat, { chatId: chat.id }),
      })
    ),
  };
});

// Управление конкретным чатом (админ)
const AdminChat: Route<Actions, { chatId: number }> = route<
  Actions,
  { chatId: number }
>('admin_chat', async ({ actions, params }) => {
  const data = await actions.getChatData(params.chatId);
  const { chatId, status, config } = data;

  return {
    text: `Управление чатом ${chatId}\nСтатус: ${status}\n\nНастройки:\n• История: ${config.historyLimit} сообщений\n• Интервал интереса: ${config.interestInterval} сообщений\n• Время темы дня: ${config.topicTime ?? 'не установлено'}`,
    buttons: [
      button({
        text: '📝 Лимит истории',
        callback: 'history',
        action: ({ navigate }) => navigate(AdminChatHistoryLimit, params),
      }),
      button({
        text: '🎯 Интервал интереса',
        callback: 'interest',
        action: ({ navigate }) => navigate(AdminChatInterestInterval, params),
      }),
      button({
        text: '📅 Время темы дня',
        callback: 'topic',
        action: ({ navigate }) => navigate(AdminChatTopicTime, params),
      }),
      ...({
        approved: [
          button<Actions>({
            text: '🚫 Заблокировать',
            callback: `ban:${chatId}`,
            action: async ({ actions, navigate, ctx }) => {
              const match = (ctx as ContextWithMatch).match;
              const id = parseInt(match?.[1] ?? '0', 10);
              await actions.banChat(id);
              return navigate(AdminChat, { chatId: id });
            },
          }),
        ],
        banned: [
          button<Actions>({
            text: '✅ Разблокировать',
            callback: `unban:${chatId}`,
            action: async ({ actions, navigate, ctx }) => {
              const match = (ctx as ContextWithMatch).match;
              const id = parseInt(match?.[1] ?? '0', 10);
              await actions.unbanChat(id);
              return navigate(AdminChat, { chatId: id });
            },
          }),
        ],
      }[status as 'approved' | 'banned'] ?? []),
    ],
  };
});

// Админские роуты настройки чатов
const AdminChatHistoryLimit = route<Actions, { chatId: number }>(
  'admin_chat_history_limit',
  async ({ params }) => ({
    text: `Введите новый лимит истории для чата ${params.chatId} (от 1 до 50):`,
    onText: async ({ text, actions, navigate }) => {
      const limit = parseInt(text, 10);
      await actions.setHistoryLimit(params.chatId, limit, true);
      return navigate(AdminChat, params);
    },
  })
);

const AdminChatInterestInterval = route<Actions, { chatId: number }>(
  'admin_chat_interest_interval',
  async ({ params }) => ({
    text: `Введите новый интервал интереса для чата ${params.chatId} (от 1 до 50):`,
    onText: async ({
      text,
      actions,
      params,
      navigate,
    }: {
      text: string;
      actions: Actions;
      params: { chatId: number };
      navigate: NavigateFn<Actions>;
    }) => {
      const interval = parseInt(text, 10);
      await actions.setInterestInterval(params.chatId, interval, true);
      return navigate(AdminChat, params);
    },
  })
);

const AdminChatTopicTime = route<Actions, { chatId: number }>(
  'admin_chat_topic_time',
  async ({ params }) => ({
    text: `Введите время темы дня для чата ${params.chatId} (формат HH:MM):`,
    onText: async ({ text, navigate }) => {
      const time = text.trim();
      // Получим часовой пояс пользователя автоматически и перейдем к подтверждению
      const date = new Date();
      const offset = -date.getTimezoneOffset();
      const hours = Math.floor(offset / 60);
      const sign = hours >= 0 ? '+' : '-';
      const timezone = `UTC${sign}${String(Math.abs(hours)).padStart(2, '0')}`;

      return navigate(AdminChatTopicTimezone, {
        chatId: params.chatId,
        time,
        timezone,
      });
    },
  })
);

const AdminChatTopicTimezone = route<
  Actions,
  { chatId: number; time: string; timezone: string }
>('admin_chat_topic_timezone', async ({ params }) => ({
  text: `Время: ${params.time}\nЧасовой пояс: ${params.timezone}\n\nВведите другой часовой пояс или оставьте этот:`,
  buttons: [
    button({
      text: `✅ Оставить ${params.timezone}`,
      callback: `accept:${params.chatId}:${params.time}:${params.timezone}`,
      action: async ({ actions, navigate, ctx }) => {
        const match = (ctx as ContextWithMatch).match;
        const chatId = parseInt(match?.[1] ?? '0', 10);
        const time = match?.[2] ?? '';
        const timezone = match?.[3] ?? 'UTC+00';

        await actions.setTopicTime(chatId, time, timezone);
        return navigate(AdminChat, { chatId });
      },
    }),
  ],
  onText: async ({
    text,
    actions,
    params,
    navigate,
  }: {
    text: string;
    actions: Actions;
    params: { chatId: number; time: string; timezone: string };
    navigate: NavigateFn<Actions>;
  }) => {
    const timezone = text.trim() || params.timezone;
    await actions.setTopicTime(params.chatId, params.time, timezone);
    return navigate(AdminChat, { chatId: params.chatId });
  },
}));

// Пользовательские настройки чата
const ChatSettings: Route<Actions> = route<Actions>(
  'chat_settings',
  async ({ actions, ctx }) => {
    const chatId = ctx.chat?.id;
    if (!chatId) throw new Error('No chat ID');

    const config = await actions.getChatConfig(chatId);

    return {
      text: `Настройки чата\n\n• История: ${config.historyLimit} сообщений\n• Интервал интереса: ${config.interestInterval} сообщений\n• Время темы дня: ${config.topicTime ?? 'не установлено'}`,
      buttons: [
        button({
          text: '📝 Лимит истории',
          callback: 'history',
          action: ({ navigate }) => navigate(ChatHistoryLimit),
        }),
        button({
          text: '🎯 Интервал интереса',
          callback: 'interest',
          action: ({ navigate }) => navigate(ChatInterestInterval),
        }),
        button({
          text: '📅 Время темы дня',
          callback: 'topic',
          action: ({ navigate }) => navigate(ChatTopicTime),
        }),
      ],
    };
  }
);

const ChatHistoryLimit: Route<Actions> = route<Actions>(
  'chat_history_limit',
  async () => ({
    text: 'Введите новый лимит истории (от 1 до 50):',
    onText: async ({
      text,
      actions,
      ctx,
      navigate,
    }: {
      text: string;
      actions: Actions;
      ctx: Context;
      navigate: NavigateFn<Actions>;
    }) => {
      const chatId = ctx.chat?.id;
      if (!chatId) throw new Error('No chat ID');

      const limit = parseInt(text, 10);
      await actions.setHistoryLimit(chatId, limit, false);
      return navigate(UserMenu);
    },
  })
);

const ChatInterestInterval: Route<Actions> = route<Actions>(
  'chat_interest_interval',
  async () => ({
    text: 'Введите новый интервал интереса (от 1 до 50):',
    onText: async ({
      text,
      actions,
      ctx,
      navigate,
    }: {
      text: string;
      actions: Actions;
      ctx: Context;
      navigate: NavigateFn<Actions>;
    }) => {
      const chatId = ctx.chat?.id;
      if (!chatId) throw new Error('No chat ID');

      const interval = parseInt(text, 10);
      await actions.setInterestInterval(chatId, interval, false);
      return navigate(UserMenu);
    },
  })
);

const ChatTopicTime: Route<Actions> = route<Actions>(
  'chat_topic_time',
  async () => ({
    text: 'Введите время темы дня (формат HH:MM):',
    onText: async ({
      text,
      ctx,
      navigate,
    }: {
      text: string;
      actions: Actions;
      ctx: Context;
      navigate: NavigateFn<Actions>;
    }) => {
      const chatId = ctx.chat?.id;
      if (!chatId) throw new Error('No chat ID');

      const time = text.trim();
      const date = new Date();
      const offset = -date.getTimezoneOffset();
      const hours = Math.floor(offset / 60);
      const sign = hours >= 0 ? '+' : '-';
      const timezone = `UTC${sign}${String(Math.abs(hours)).padStart(2, '0')}`;

      return navigate(ChatTopicTimezone, { time, timezone });
    },
  })
);

const ChatTopicTimezone: Route<Actions, { time: string; timezone: string }> =
  route<Actions, { time: string; timezone: string }>(
    'chat_topic_timezone',
    async ({ params }) => ({
      text: `Время: ${params.time}\nЧасовой пояс: ${params.timezone}\n\nВведите другой часовой пояс или оставьте этот:`,
      buttons: [
        button({
          text: `✅ Оставить ${params.timezone}`,
          callback: `accept:${params.time}:${params.timezone}`,
          action: async ({ actions, ctx, navigate }) => {
            const chatId = ctx.chat?.id;
            if (!chatId) throw new Error('No chat ID');

            const match = (ctx as ContextWithMatch).match;
            const time = match?.[1] ?? '';
            const timezone = match?.[2] ?? 'UTC+00';

            await actions.setTopicTime(chatId, time, timezone);
            return navigate(UserMenu);
          },
        }),
      ],
      onText: async ({
        text,
        actions,
        ctx,
        params,
        navigate,
      }: {
        text: string;
        actions: Actions;
        ctx: Context;
        params: { time: string; timezone: string };
        navigate: NavigateFn<Actions>;
      }) => {
        const chatId = ctx.chat?.id;
        if (!chatId) throw new Error('No chat ID');

        const timezone = text.trim() || params.timezone;
        await actions.setTopicTime(chatId, params.time, timezone);
        return navigate(UserMenu);
      },
    })
  );

// Роуты запросов и ошибок
const ChatNotApproved: Route<Actions> = route<Actions>(
  'chat_not_approved',
  async () => ({
    text: 'Этот чат не находится в списке разрешённых.',
    buttons: [
      button({
        text: '📝 Запросить доступ',
        callback: 'request_access',
        action: async ({ actions, ctx }) => {
          await actions.requestChatAccess(ctx);
        },
      }),
    ],
  })
);

const NoAccess: Route<Actions> = route<Actions>('no_access', async () => ({
  text: '❌ У вас нет доступа к данным этого чата.\n\nДля получения доступа обратитесь к администратору бота.',
  buttons: [
    button({
      text: '📝 Запросить доступ',
      callback: 'request_user_access',
      action: async ({ actions, ctx }) => {
        await actions.requestUserAccess(ctx);
      },
    }),
  ],
}));

const ChatApprovalRequest: Route<Actions, { name: string; chatId: number }> =
  route<Actions, { name: string; chatId: number }>(
    'chat_approval_request',
    async ({ params }) => ({
      text: `Запрос на добавление чата:\n\n${params.name}\n\nРазрешить доступ?`,
      buttons: [
        button({
          text: '✅ Одобрить',
          callback: 'approve',
          action: async ({ actions, ctx }) => {
            const match = (ctx as ContextWithMatch).match;
            const chatId = parseInt(match?.[1] ?? '0', 10);
            await actions.approveChat(chatId);
          },
          answer: { text: 'Чат одобрен' },
        }),
        button({
          text: '🚫 Заблокировать',
          callback: 'ban',
          action: async ({ actions, ctx }) => {
            const match = (ctx as ContextWithMatch).match;
            const chatId = parseInt(match?.[1] ?? '0', 10);
            await actions.banChat(chatId);
          },
          answer: { text: 'Чат заблокирован' },
        }),
      ],
    })
  );

const UserAccessRequest: Route<
  Actions,
  { msg: string; chatId: number; userId: number }
> = route<Actions, { msg: string; chatId: number; userId: number }>(
  'user_access_request',
  async ({ params }) => ({
    text: `Запрос доступа к данным:\n\n${params.msg}\n\nРазрешить доступ?`,
    buttons: [
      button({
        text: '✅ Одобрить доступ',
        callback: 'approve_user',
        action: async ({ actions, ctx }) => {
          const match = (ctx as ContextWithMatch).match;
          const chatId = parseInt(match?.[1] ?? '0', 10);
          const userId = parseInt(match?.[2] ?? '0', 10);
          const expiresAt = await actions.approveUser(chatId, userId);
          await ctx.reply(
            `Одобрено для чата ${chatId} и пользователя ${userId}\nДоступ действует до: ${expiresAt.toISOString()}`
          );
        },
      }),
    ],
  })
);

// Создание роутера с иерархической структурой
// eslint-disable-next-line import/no-unused-modules
export const router = createRouter<Actions>(
  [
    // Корневой уровень
    {
      route: Menu,
      children: [
        // Админская ветка
        {
          route: AdminMenu,
          children: [
            {
              route: AdminChats,
              hasBack: true,
              children: [
                {
                  route: AdminChat,
                  hasBack: true,
                  children: [
                    { route: AdminChatHistoryLimit, hasBack: true },
                    { route: AdminChatInterestInterval, hasBack: true },
                    {
                      route: AdminChatTopicTime,
                      hasBack: true,
                      children: [
                        { route: AdminChatTopicTimezone, hasBack: true },
                      ],
                    },
                  ],
                },
              ],
            },
            { route: ChatApprovalRequest, hasBack: true },
            { route: UserAccessRequest, hasBack: true },
          ],
        },

        // Пользовательская ветка
        {
          route: UserMenu,
          children: [
            {
              route: ChatSettings,
              hasBack: true,
              children: [
                { route: ChatHistoryLimit, hasBack: true },
                { route: ChatInterestInterval, hasBack: true },
                {
                  route: ChatTopicTime,
                  hasBack: true,
                  children: [{ route: ChatTopicTimezone, hasBack: true }],
                },
              ],
            },
          ],
        },
      ],
    },

    // Отдельные роуты без иерархии
    ChatNotApproved,
    NoAccess,
  ],
  [
    // Branches для команд
    branch('menu', 'Показать меню', Menu),
    branch('start', 'Начать работу', Menu),
  ],
  {
    backLabel: '← Назад',
    cancelLabel: '❌ Отмена',
    inputPrompt: 'Введите значение:',
    errorDefaultText: 'Произошла ошибка',
  }
);

// Setup функция для настройки бота

export function setupBotRouting(
  bot: Telegraf,
  actions: Actions
): RunningRouter<Actions> {
  const running = router.run(bot, actions);

  // Обработка my_chat_member через onConnect
  running.onConnect(async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const status = await actions.checkChatStatus(chatId);
    if (status !== 'approved') {
      await running.navigate(ctx, ChatNotApproved);
    }
  });

  // Обработка текстовых сообщений для триггер пайплайна
  running.onText(async (ctx) => {
    await actions.processMessage(ctx);
  });

  return running;
}
