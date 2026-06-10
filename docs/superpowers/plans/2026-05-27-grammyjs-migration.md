# grammyjs Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `telegraf` and the custom `inline-router` with `grammy` + official plugins, deleting ~11 files of hand-rolled routing infrastructure.

**Architecture:** Big-bang migration on a single branch. `telegraf` is removed entirely and replaced with `grammy`. The custom `src/view/telegram/inline-router/` directory is deleted. `routes.ts` is rewritten using `@grammyjs/menu` for keyboard navigation and `@grammyjs/conversations` for text-input flows. All application/domain layers are untouched except for a one-line import change (`Context` from `telegraf` → `grammy`).

**Tech Stack:** `grammy` v1.43.0 (includes session middleware), `@grammyjs/menu` v1.3.1, `@grammyjs/conversations` v2.1.1

---

## File Map

| Action         | File                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| **Create**     | `src/view/telegram/context.ts`                                         |
| **Modify**     | `src/application/interfaces/chat/ChatMessenger.ts`                     |
| **Modify**     | `src/application/interfaces/chat/TriggerPipeline.ts`                   |
| **Modify**     | `src/application/interfaces/chat/ChatResponder.ts`                     |
| **Modify**     | `src/application/interfaces/messages/MessageContextExtractor.ts`       |
| **Modify**     | `src/application/use-cases/messages/MessageFactory.ts`                 |
| **Modify**     | `src/application/use-cases/messages/DefaultMessageContextExtractor.ts` |
| **Modify**     | `src/application/use-cases/chat/DefaultTriggerPipeline.ts`             |
| **Modify**     | `src/application/use-cases/chat/DefaultChatResponder.ts`               |
| **Modify**     | `src/view/telegram/triggers/MentionTrigger.ts`                         |
| **Modify**     | `src/view/telegram/triggers/ReplyTrigger.ts`                           |
| **Modify**     | `src/view/telegram/triggers/NameTrigger.ts`                            |
| **Modify**     | `src/view/telegram/triggers/InterestTrigger.ts`                        |
| **Rewrite**    | `src/view/telegram/TelegramMessenger.ts`                               |
| **Delete dir** | `src/view/telegram/inline-router/` (11 files)                          |
| **Rewrite**    | `src/view/telegram/routes.ts`                                          |
| **Modify**     | `src/view/telegram/MainService.ts`                                     |
| **Modify**     | `src/container/view.ts`                                                |
| **Delete**     | `test/inlineRouter.test.ts`                                            |
| **Delete**     | `test/inlineRouter.bugfixes.test.ts`                                   |
| **Delete**     | `test/inlineRouter.renderModes.test.ts`                                |
| **Delete**     | `test/inlineRouter.onText.test.ts`                                     |
| **Delete**     | `test/routes.test.ts`                                                  |
| **Modify**     | `test/Triggers.test.ts`                                                |
| **Modify**     | `test/TriggerPipeline.test.ts`                                         |
| **Modify**     | `test/ChatResponder.test.ts`                                           |
| **Modify**     | `test/InterestTrigger.test.ts`                                         |
| **Modify**     | `test/MessageFactory.test.ts`                                          |
| **Modify**     | `test/MessageContextExtractor.test.ts`                                 |
| **Modify**     | `test/MainService.test.ts`                                             |

---

## Task 1: Create git branch

**Files:** none (git only)

- [ ] **Step 1: Create and switch to migration branch**

```bash
git checkout -b feat/grammy-migration
```

Expected: `Switched to a new branch 'feat/grammy-migration'`

- [ ] **Step 2: Verify clean working tree**

```bash
git status
```

Expected: only the staged spec file from main, nothing else untracked.

---

## Task 2: Update dependencies

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Remove telegraf, install grammy packages**

```bash
npm uninstall telegraf && npm install grammy@1.43.0 @grammyjs/menu@1.3.1 @grammyjs/conversations@2.1.1
```

Expected: telegraf removed from node_modules, grammy packages present.

- [ ] **Step 2: Verify install**

```bash
node -e "require('grammy'); require('@grammyjs/menu'); require('@grammyjs/conversations'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: replace telegraf with grammy and plugins"
```

---

## Task 3: Create BotContext type file

**Files:**

- Create: `src/view/telegram/context.ts`

This file centralises the extended grammy context type used across all view-layer files.

- [ ] **Step 1: Create the file**

```typescript
// src/view/telegram/context.ts
import { type Context, type SessionFlavor } from 'grammy';
import { type ConversationFlavor } from '@grammyjs/conversations';

export interface SessionData {
  selectedChatId?: number;
}

export type BotContext = Context &
  SessionFlavor<SessionData> &
  ConversationFlavor;
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```

Expected: errors only about missing grammy in existing files (telegraf still imported), not about context.ts itself.

---

## Task 4: Update application interfaces

**Files:**

- Modify: `src/application/interfaces/chat/ChatMessenger.ts`
- Modify: `src/application/interfaces/chat/TriggerPipeline.ts`
- Modify: `src/application/interfaces/chat/ChatResponder.ts`
- Modify: `src/application/interfaces/messages/MessageContextExtractor.ts`

Replace `import type { ... } from 'telegraf'` with grammy equivalents in all four interface files.

- [ ] **Step 1: Update ChatMessenger.ts**

Replace the entire file content:

```typescript
// src/application/interfaces/chat/ChatMessenger.ts
import type { Bot } from 'grammy';
import type { ServiceIdentifier } from 'inversify';

export interface ChatMessenger {
  readonly bot: Bot;
  sendMessage(chatId: number, text: string, extra?: object): Promise<void>;
  launch(): Promise<void>;
  stop(reason: string): void;
}

export const CHAT_MESSENGER_ID = Symbol.for(
  'ChatMessenger'
) as ServiceIdentifier<ChatMessenger>;
```

- [ ] **Step 2: Update TriggerPipeline.ts**

Replace the entire file content:

```typescript
// src/application/interfaces/chat/TriggerPipeline.ts
import type { ServiceIdentifier } from 'inversify';
import type { Context } from 'grammy';

import type { TriggerContext, TriggerResult } from '@/domain/triggers/Trigger';

export interface TriggerPipeline {
  shouldRespond(
    ctx: Context,
    context: TriggerContext
  ): Promise<TriggerResult | null>;
}

export const TRIGGER_PIPELINE_ID = Symbol.for(
  'TriggerPipeline'
) as ServiceIdentifier<TriggerPipeline>;
```

- [ ] **Step 3: Update ChatResponder.ts**

Replace the entire file content:

```typescript
// src/application/interfaces/chat/ChatResponder.ts
import type { ServiceIdentifier } from 'inversify';
import type { Context } from 'grammy';

import type { TriggerReason } from '@/domain/triggers/Trigger';

export interface ChatResponder {
  generate(
    ctx: Context,
    chatId: number,
    triggerReason?: TriggerReason
  ): Promise<string>;
}

export const CHAT_RESPONDER_ID = Symbol.for(
  'ChatResponder'
) as ServiceIdentifier<ChatResponder>;
```

- [ ] **Step 4: Update MessageContextExtractor.ts**

Replace the entire file content:

```typescript
// src/application/interfaces/messages/MessageContextExtractor.ts
import type { ServiceIdentifier } from 'inversify';
import type { Context } from 'grammy';

export interface MessageContext {
  replyText?: string;
  replyUsername?: string;
  quoteText?: string;
  username: string;
  fullName: string;
}

export interface MessageContextExtractor {
  extract(ctx: Context): MessageContext;
}

export const MESSAGE_CONTEXT_EXTRACTOR_ID = Symbol.for(
  'MessageContextExtractor'
) as ServiceIdentifier<MessageContextExtractor>;
```

- [ ] **Step 5: Commit**

```bash
git add src/application/interfaces/
git commit -m "refactor: update application interfaces to use grammy Context"
```

---

## Task 5: Update application use-case implementations

**Files:**

- Modify: `src/application/use-cases/messages/MessageFactory.ts`
- Modify: `src/application/use-cases/messages/DefaultMessageContextExtractor.ts`
- Modify: `src/application/use-cases/chat/DefaultTriggerPipeline.ts`
- Modify: `src/application/use-cases/chat/DefaultChatResponder.ts`

All four files only need import changes — no logic changes.

- [ ] **Step 1: Update MessageFactory.ts**

Replace `import type { Context } from 'telegraf';` with:

```typescript
import type { Context } from 'grammy';
```

`ctx.message`, `ctx.from`, `ctx.chat`, `ctx.me` work identically in grammy.

- [ ] **Step 2: Update DefaultMessageContextExtractor.ts**

Replace the two telegraf imports:

```typescript
// Remove:
import type { Context } from 'telegraf';
import type { Message } from 'telegraf/typings/core/types/typegram';

// Add:
import type { Context } from 'grammy';
import type { Message } from 'grammy/types';
```

`Message` from `grammy/types` has the same shape as telegraf's typegram Message.

- [ ] **Step 3: Update DefaultTriggerPipeline.ts**

Replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

- [ ] **Step 4: Update DefaultChatResponder.ts**

Replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/
git commit -m "refactor: update use-case implementations to use grammy Context"
```

---

## Task 6: Update view trigger files

**Files:**

- Modify: `src/view/telegram/triggers/MentionTrigger.ts`
- Modify: `src/view/telegram/triggers/ReplyTrigger.ts`
- Modify: `src/view/telegram/triggers/NameTrigger.ts`
- Modify: `src/view/telegram/triggers/InterestTrigger.ts`

Import-only changes. All four files use `Context` from telegraf only in the type annotation of `apply()`. The actual ctx property access (`ctx.message`, `ctx.from`, `ctx.me`) is identical in grammy.

- [ ] **Step 1: In all 4 trigger files, replace the telegraf import**

In each of the four files, replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

Files to update:

- `src/view/telegram/triggers/MentionTrigger.ts` (line 2)
- `src/view/telegram/triggers/ReplyTrigger.ts` (line 2)
- `src/view/telegram/triggers/NameTrigger.ts` (line 2)
- `src/view/telegram/triggers/InterestTrigger.ts` (line 2)

- [ ] **Step 2: Commit**

```bash
git add src/view/telegram/triggers/
git commit -m "refactor: update trigger files to use grammy Context"
```

---

## Task 7: Rewrite TelegramMessenger.ts

**Files:**

- Rewrite: `src/view/telegram/TelegramMessenger.ts`

Replace `Telegraf` with `Bot<BotContext>`. Install `session` and `conversations` middleware. Map telegraf API calls to grammy equivalents (`bot.telegram.X` → `bot.api.X`, `bot.launch()` → `bot.start()`).

- [ ] **Step 1: Replace the entire file**

```typescript
// src/view/telegram/TelegramMessenger.ts
import { inject, injectable } from 'inversify';
import { Bot, session } from 'grammy';
import { conversations } from '@grammyjs/conversations';

import type { ChatMessenger } from '@/application/interfaces/chat/ChatMessenger';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type { BotContext, SessionData } from './context';

@injectable()
export class TelegramMessenger implements ChatMessenger {
  public readonly bot: Bot<BotContext>;
  private readonly logger: Logger;

  constructor(
    @inject(ENV_SERVICE_ID) envService: EnvService,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.bot = new Bot<BotContext>(envService.env.BOT_TOKEN);
    this.bot.use(
      session<SessionData, BotContext>({ initial: (): SessionData => ({}) })
    );
    this.bot.use(conversations());
    this.logger = loggerFactory.create('TelegramMessenger');
  }

  async launch(): Promise<void> {
    this.logger.info('Launching bot');
    await this.bot.api
      .deleteWebhook()
      .catch((err) =>
        this.logger.warn({ err }, 'Failed to delete existing webhook')
      );
    void this.bot
      .start({ onStart: () => this.logger.info('Bot launched') })
      .catch((err) => this.logger.error({ err }, 'Failed to launch bot'));
  }

  stop(reason: string): void {
    this.logger.info({ reason }, 'Stopping bot');
    void this.bot.stop();
  }

  async sendMessage(
    chatId: number,
    text: string,
    extra?: object
  ): Promise<void> {
    await this.bot.api.sendMessage(chatId, text, extra);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/view/telegram/TelegramMessenger.ts
git commit -m "refactor: rewrite TelegramMessenger with grammy Bot"
```

---

## Task 8: Delete inline-router directory

**Files:**

- Delete dir: `src/view/telegram/inline-router/`

- [ ] **Step 1: Delete all 11 files**

```bash
rm -rf src/view/telegram/inline-router/
```

- [ ] **Step 2: Verify deletion**

```bash
ls src/view/telegram/
```

Expected: `MainService.ts  TelegramMessenger.ts  context.ts  routes.ts  triggers/`
(`inline-router/` should be gone)

- [ ] **Step 3: Commit**

```bash
git add -A src/view/telegram/inline-router/
git commit -m "refactor: delete custom inline-router (replaced by @grammyjs/menu)"
```

---

## Task 9: Rewrite routes.ts

**Files:**

- Rewrite: `src/view/telegram/routes.ts`

This is the largest task. Replace the entire DSL-based routing with `@grammyjs/menu` menus and `@grammyjs/conversations` text-input flows. The `Actions` interface contract stays the same (except `ctx` type changes from telegraf `Context` to `BotContext`). The exported function signature is `setupBotRouting(bot, actions): void`.

- [ ] **Step 1: Replace the entire file**

```typescript
// src/view/telegram/routes.ts
import assert from 'node:assert';

import { Bot, InputFile } from 'grammy';
import { type Conversation, createConversation } from '@grammyjs/conversations';
import { Menu } from '@grammyjs/menu';

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

type BotConversation = Conversation<BotContext>;

function makeConversations(actions: Actions) {
  async function adminHistoryLimit(
    conversation: BotConversation,
    ctx: BotContext
  ) {
    const chatId = ctx.session.selectedChatId;
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
  ) {
    const chatId = ctx.session.selectedChatId;
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
  ) {
    const chatId = ctx.session.selectedChatId;
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
  ) {
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
  ) {
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

  async function userTopicTime(conversation: BotConversation, ctx: BotContext) {
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

function buildMenus(actions: Actions) {
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
    if (actions.isAdmin(ctx.from?.id ?? 0)) {
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
```

- [ ] **Step 2: Commit**

```bash
git add src/view/telegram/routes.ts
git commit -m "refactor: rewrite routes.ts using @grammyjs/menu and @grammyjs/conversations"
```

---

## Task 10: Rewrite MainService.ts

**Files:**

- Modify: `src/view/telegram/MainService.ts`

Key changes:

- Import `Bot` from `grammy` instead of `Telegraf`
- Import `BotContext` from `./context`
- Replace `RunningRouter` with `void` return for `setupBotRouting`
- Replace `ctx.answerCbQuery` → `ctx.answerCallbackQuery`
- Replace `ctx.replyWithDocument({ source, filename })` → `ctx.replyWithDocument(new InputFile(...))`
- Replace `ctx.telegram.sendChatAction` → `ctx.api.sendChatAction`
- Replace `this.bot.telegram.deleteMessage` → `this.bot.api.deleteMessage`
- Remove `RunningRouter` field and type

- [ ] **Step 1: Replace the entire file**

```typescript
// src/view/telegram/MainService.ts
import assert from 'node:assert';

import { inject, injectable, LazyServiceIdentifier } from 'inversify';
import { type Bot, InputFile } from 'grammy';

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

import type { BotContext } from './context';
import { type Actions, setupBotRouting } from './routes';

async function withTyping(
  ctx: BotContext,
  fn: () => Promise<void>
): Promise<void> {
  await ctx.sendChatAction('typing');
  const chatId = ctx.chat?.id;

  const timer = setInterval(() => {
    if (chatId !== undefined) {
      ctx.api.sendChatAction(chatId, 'typing').catch(() => {});
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
  private readonly bot: Bot<BotContext>;
  private env: Env;
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
    this.bot = messenger.bot as Bot<BotContext>;
    this.scheduler = scheduler;
    this.logger = loggerFactory.create('MainService');
    this.logger.info(
      { ADMIN_CHAT_ID: this.env.ADMIN_CHAT_ID },
      '[INIT] MainService initialized with ADMIN_CHAT_ID'
    );
    const actions: Actions = {
      exportData: (ctx: BotContext) => this.handleExportData(ctx),
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
        this.admin.createAccessKey(userId, chatId),
      hasUserAccess: (chatId: number, userId: number) =>
        this.admin.hasAccess(chatId, userId),
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
      processMessage: (ctx: BotContext) => this.handleMessage(ctx),
      isAdmin: (userId: number) => userId === this.env.ADMIN_CHAT_ID,
      log: (level, message, data) => this.logger[level](data ?? {}, message),
    };
    setupBotRouting(this.bot, actions);
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
    await this.messenger.sendMessage(
      this.env.ADMIN_CHAT_ID,
      `Запрос на доступ от чата: ${name}`
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
      interestInterval: number;
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

    try {
      await this.messenger.sendMessage(this.env.ADMIN_CHAT_ID, msg);
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

  private async handleExportData(ctx: BotContext): Promise<void> {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    assert(chatId, 'This is not a chat');
    assert(userId, 'No user id');
    this.logger.info({ chatId, userId }, 'Export data requested');

    await ctx.answerCallbackQuery('Начинаю загрузку данных...');

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
        await ctx.replyWithDocument(new InputFile(f.buffer, f.filename));
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

  private async handleResetMemory(ctx: BotContext): Promise<void> {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    assert(chatId, 'This is not a chat');
    assert(userId, 'No user id');

    if (chatId !== this.env.ADMIN_CHAT_ID) {
      const allowed = await this.admin.hasAccess(chatId, userId);
      if (!allowed) {
        await ctx.answerCallbackQuery('Нет доступа или ключ просрочен');
        return;
      }
    }

    await ctx.answerCallbackQuery('Сбрасываю память диалога...');

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
      void ctx.reply(answer, {
        reply_parameters: replyId ? { message_id: replyId } : undefined,
      });
      this.logger.debug({ chatId }, 'Reply sent');
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/view/telegram/MainService.ts
git commit -m "refactor: rewrite MainService to use grammy Bot and BotContext"
```

---

## Task 11: Update container/view.ts

**Files:**

- Modify: `src/container/view.ts`

Replace telegraf `Context` import with grammy. The `Trigger<Context>` bindings need grammy's Context.

- [ ] **Step 1: Replace the entire file**

```typescript
// src/container/view.ts
import { type Container } from 'inversify';
import type { Context } from 'grammy';

import { type Trigger, TRIGGER_ID } from '../domain/triggers/Trigger';
import { MainService } from '../view/telegram/MainService';
import { InterestTrigger } from '../view/telegram/triggers/InterestTrigger';
import { MentionTrigger } from '../view/telegram/triggers/MentionTrigger';
import { NameTrigger } from '../view/telegram/triggers/NameTrigger';
import { ReplyTrigger } from '../view/telegram/triggers/ReplyTrigger';

export const register = (container: Container): void => {
  container
    .bind<Trigger<Context>>(TRIGGER_ID)
    .to(MentionTrigger)
    .inSingletonScope();
  container
    .bind<Trigger<Context>>(TRIGGER_ID)
    .to(ReplyTrigger)
    .inSingletonScope();
  container
    .bind<Trigger<Context>>(TRIGGER_ID)
    .to(NameTrigger)
    .inSingletonScope();
  container
    .bind<Trigger<Context>>(TRIGGER_ID)
    .to(InterestTrigger)
    .inSingletonScope();

  container.bind(MainService).toSelf().inSingletonScope();
};
```

- [ ] **Step 2: Commit**

```bash
git add src/container/view.ts
git commit -m "refactor: update DI container to use grammy Context"
```

---

## Task 12: Delete inline-router tests, update remaining tests

**Files:**

- Delete: `test/inlineRouter.test.ts`
- Delete: `test/inlineRouter.bugfixes.test.ts`
- Delete: `test/inlineRouter.renderModes.test.ts`
- Delete: `test/inlineRouter.onText.test.ts`
- Delete: `test/routes.test.ts`
- Modify: `test/Triggers.test.ts`
- Modify: `test/TriggerPipeline.test.ts`
- Modify: `test/ChatResponder.test.ts`
- Modify: `test/InterestTrigger.test.ts`
- Modify: `test/MessageFactory.test.ts`
- Modify: `test/MessageContextExtractor.test.ts`
- Modify: `test/MainService.test.ts`

- [ ] **Step 1: Delete the 5 inline-router test files**

```bash
rm test/inlineRouter.test.ts test/inlineRouter.bugfixes.test.ts test/inlineRouter.renderModes.test.ts test/inlineRouter.onText.test.ts test/routes.test.ts
```

- [ ] **Step 2: Update Triggers.test.ts — replace Context import**

In `test/Triggers.test.ts`, replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

- [ ] **Step 3: Update TriggerPipeline.test.ts — replace Context import**

In `test/TriggerPipeline.test.ts`, replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

- [ ] **Step 4: Update ChatResponder.test.ts — replace Context import**

In `test/ChatResponder.test.ts`, replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

- [ ] **Step 5: Update InterestTrigger.test.ts — replace Context import**

In `test/InterestTrigger.test.ts`, replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

- [ ] **Step 6: Update MessageFactory.test.ts — replace Context import**

In `test/MessageFactory.test.ts`, replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

- [ ] **Step 7: Update MessageContextExtractor.test.ts — replace Context import**

In `test/MessageContextExtractor.test.ts`, replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

- [ ] **Step 8: Update MainService.test.ts — replace Context import and fix mock bot**

In `test/MainService.test.ts`, replace:

```typescript
import type { Context } from 'telegraf';
```

With:

```typescript
import type { Context } from 'grammy';
```

Also replace the `createMockBot` function (telegraf used `.telegram.setMyCommands`, grammy uses `.api.setMyCommands`):

```typescript
// Old:
const createMockBot = () => ({
  telegram: { setMyCommands: vi.fn().mockResolvedValue(undefined) },
  on: vi.fn(),
  command: vi.fn(),
  action: vi.fn(),
  use: vi.fn(),
});

// New:
const createMockBot = () => ({
  api: {
    setMyCommands: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  },
  on: vi.fn(),
  command: vi.fn(),
  use: vi.fn(),
});
```

Also update the mock ctx in the admin chat test (line 244):

```typescript
// Old:
const adminCtx = { chat: { id: 1 } } as Context;
// New — same, Context from grammy has same shape:
const adminCtx = { chat: { id: 1 } } as unknown as Context;
```

- [ ] **Step 9: Commit**

```bash
git add -A test/
git commit -m "test: delete inline-router tests, update Context imports to grammy"
```

---

## Task 13: Build, type-check, and lint

**Files:** none (verification only)

- [ ] **Step 1: Run TypeScript type check**

```bash
npm run type:check
```

Expected: no errors. If errors appear, fix them before continuing. Common issues:

- Missing `grammy` types — check that grammy is in node_modules
- `Bot<BotContext>` not assignable to `Bot` — use `as Bot` cast if needed
- `ctx.session` type errors — ensure `SessionFlavor<SessionData>` is in BotContext

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: successful build with no TypeScript errors.

- [ ] **Step 3: Run lint fix**

```bash
npm run lint:fix
```

Expected: no unfixable lint errors.

- [ ] **Step 4: Run format fix**

```bash
npm run format:fix
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass. The 5 deleted inline-router test files are gone. The remaining ~28 test files should pass.

If branch coverage drops below 80%: check which branches were previously covered by inline-router tests and decide whether to add replacement coverage for routes.ts/MainService.ts, or adjust the threshold.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: fix lint and formatting after grammy migration"
```

---

## Spec Coverage Check

| Spec requirement                                                                                    | Task    |
| --------------------------------------------------------------------------------------------------- | ------- |
| Remove telegraf                                                                                     | Task 2  |
| Add grammy, @grammyjs/menu, @grammyjs/conversations                                                 | Task 2  |
| Create BotContext type                                                                              | Task 3  |
| Update ChatMessenger interface                                                                      | Task 4  |
| Update TriggerPipeline, ChatResponder, MessageContextExtractor interfaces                           | Task 4  |
| Update MessageFactory, DefaultMessageContextExtractor, DefaultTriggerPipeline, DefaultChatResponder | Task 5  |
| Update 4 trigger files                                                                              | Task 6  |
| Rewrite TelegramMessenger (bot.start, bot.api.\*)                                                   | Task 7  |
| Delete inline-router directory                                                                      | Task 8  |
| Rewrite routes.ts with @grammyjs/menu and @grammyjs/conversations                                   | Task 9  |
| Rewrite MainService.ts (answerCallbackQuery, InputFile, bot.api.\*)                                 | Task 10 |
| Update container/view.ts                                                                            | Task 11 |
| Delete inline-router tests, update test imports                                                     | Task 12 |
| Build and type-check                                                                                | Task 13 |
