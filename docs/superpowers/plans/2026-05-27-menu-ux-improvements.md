# Menu UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve menu UX — cancel buttons, message cleanup, export progress, reset confirmation, correct admin/user routing.

**Architecture:** Enhance existing `@grammyjs/conversations` and `@grammyjs/menu` setup in `routes.ts`. Add a shared `waitForInputOrCancel` helper for all conversations. Move export progress logic to `MainService.ts` using `editMessageText`. Add confirmation submenu for memory reset. Fix permission check in `/start` command.

**Tech Stack:** grammY, @grammyjs/conversations, @grammyjs/menu, vitest

---

## File Structure

| File                               | Role                                      | Change                                                                                                                                             |
| ---------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/view/telegram/routes.ts`      | Menu builders, conversations, bot routing | Major rewrite: add helper, rewrite all 6 conversations, add `confirm_reset` submenu, fix `/start` permission, update `exportData` action signature |
| `src/view/telegram/MainService.ts` | Business logic, action implementations    | Modify `handleExportData` for progress via `editMessageText`, simplify `handleResetMemory` (confirmation moves to menu layer)                      |
| `src/view/telegram/context.ts`     | Session types                             | No changes needed (inline keyboard doesn't require session state)                                                                                  |

---

### Task 1: Fix admin/user permission check in /start command

**Files:**

- Modify: `src/view/telegram/routes.ts:386`

This is the simplest, most isolated fix. Do it first.

- [ ] **Step 1: Fix the permission check**

In `src/view/telegram/routes.ts`, change the `/start` command handler:

```typescript
// Before (line 386):
if (actions.isAdmin(ctx.from?.id ?? 0)) {

// After:
if (actions.isAdmin(ctx.chat?.id ?? 0)) {
```

- [ ] **Step 2: Build to verify no type errors**

Run: `npm run type:check`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/view/telegram/routes.ts
git commit -m "fix: use chat.id instead of from.id for admin menu routing"
```

---

### Task 2: Add `waitForInputOrCancel` conversation helper

**Files:**

- Modify: `src/view/telegram/routes.ts` (add helper function after the `BotConversation` type alias, line 78)

- [ ] **Step 1: Add the `InlineKeyboard` import**

Add `InlineKeyboard` to the grammy import at line 5:

```typescript
import type { Bot } from 'grammy';
```

becomes:

```typescript
import { InlineKeyboard, type Bot } from 'grammy';
```

- [ ] **Step 2: Write the helper types and function**

Add after line 78 (`type BotConversation = ...`):

```typescript
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
```

- [ ] **Step 3: Build to verify no type errors**

Run: `npm run type:check`
Expected: no errors (helper is defined but unused warnings are ok since we use it in next tasks)

- [ ] **Step 4: Commit**

```bash
git add src/view/telegram/routes.ts
git commit -m "feat: add waitForInputOrCancel conversation helper with cancel button and cleanup"
```

---

### Task 3: Rewrite user conversations to use the helper

**Files:**

- Modify: `src/view/telegram/routes.ts` (replace `userHistoryLimit`, `userInterestInterval`, `userTopicTime` functions)
- Modify: `src/view/telegram/routes.ts` (update `chatSettings` menu to pass `userMenu` for re-rendering after success)

- [ ] **Step 1: Add `sendMenuMessage` helper for re-sending menu after conversation completes**

Add after `waitForInputOrCancel`, before `makeConversations`:

```typescript
type MenuRef = { menu: Menu<BotContext>; title: string };
```

Update `makeConversations` signature to accept menu refs:

```typescript
function makeConversations(
  actions: Actions,
  menuRefs: { userMenu: MenuRef; adminMenu: MenuRef; chatSettings: MenuRef; adminChat: MenuRef }
): Record<
  string,
  (conversation: BotConversation, ctx: BotContext) => Promise<void>
> {
```

- [ ] **Step 2: Rewrite `userHistoryLimit`**

Replace the existing `userHistoryLimit` function (lines 148-163):

```typescript
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
```

- [ ] **Step 3: Rewrite `userInterestInterval`**

Replace the existing `userInterestInterval` function (lines 165-180):

```typescript
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
```

- [ ] **Step 4: Rewrite `userTopicTime`**

Replace the existing `userTopicTime` function (lines 182-196):

```typescript
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
```

- [ ] **Step 5: Build to verify no type errors**

Run: `npm run type:check`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/view/telegram/routes.ts
git commit -m "feat: rewrite user conversations with cancel button and message cleanup"
```

---

### Task 4: Rewrite admin conversations to use the helper

**Files:**

- Modify: `src/view/telegram/routes.ts` (replace `adminHistoryLimit`, `adminInterestInterval`, `adminTopicTime` functions)

- [ ] **Step 1: Rewrite `adminHistoryLimit`**

Replace the existing function (lines 86-103):

```typescript
async function adminHistoryLimit(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
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
  await ctx.api.sendMessage(ctx.chat!.id, '✅ Лимит установлен', {
    reply_markup: menuRefs.adminChat.menu,
  });
}
```

- [ ] **Step 2: Rewrite `adminInterestInterval`**

Replace the existing function (lines 105-122):

```typescript
async function adminInterestInterval(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
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
  await ctx.api.sendMessage(ctx.chat!.id, '✅ Интервал установлен', {
    reply_markup: menuRefs.adminChat.menu,
  });
}
```

- [ ] **Step 3: Rewrite `adminTopicTime`**

Replace the existing function (lines 124-146):

```typescript
async function adminTopicTime(
  conversation: BotConversation,
  ctx: BotContext
): Promise<void> {
  const chatId = await conversation.external(() => ctx.session?.selectedChatId);
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
    ctx.chat!.id,
    `✅ Время ${timeResult.value} (${tzResult.value}) установлено`,
    { reply_markup: menuRefs.adminChat.menu }
  );
}
```

- [ ] **Step 4: Build to verify no type errors**

Run: `npm run type:check`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/view/telegram/routes.ts
git commit -m "feat: rewrite admin conversations with cancel button and message cleanup"
```

---

### Task 5: Wire up menu refs — restructure `buildMenus` and `setupBotRouting`

**Files:**

- Modify: `src/view/telegram/routes.ts` (restructure `buildMenus` to build menus first, then pass refs to `makeConversations`)

The problem: `makeConversations` now needs menu references, but menus are built in `buildMenus` which is called separately. We need to restructure `setupBotRouting` to build menus first, then pass refs to conversations.

- [ ] **Step 1: Restructure `setupBotRouting` to build menus first, then conversations**

Replace the entire `setupBotRouting` function:

```typescript
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
```

- [ ] **Step 2: Update `buildMenus` return type to include `chatSettings` and `adminChat`**

Change the return type and return statement of `buildMenus`:

```typescript
function buildMenus(actions: Actions): {
  adminMenu: Menu<BotContext>;
  userMenu: Menu<BotContext>;
  chatNotApprovedMenu: Menu<BotContext>;
  chatSettings: Menu<BotContext>;
  adminChat: Menu<BotContext>;
} {
```

And update the return at the end:

```typescript
return { adminMenu, userMenu, chatNotApprovedMenu, chatSettings, adminChat };
```

- [ ] **Step 3: Build to verify no type errors**

Run: `npm run type:check`
Expected: no errors

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/view/telegram/routes.ts
git commit -m "refactor: wire menu refs to conversations for post-input menu rendering"
```

---

### Task 6: Add memory reset confirmation submenu

**Files:**

- Modify: `src/view/telegram/routes.ts` (add `confirm_reset` submenu in `buildMenus`)
- Modify: `src/view/telegram/MainService.ts` (update `handleResetMemory` — remove access check from handler since menu layer handles navigation, and accept `messageId` for progress editing)

- [ ] **Step 1: Update `Actions` interface for reset with message editing**

In `routes.ts`, update the `resetMemory` signature in the `Actions` interface:

```typescript
export interface Actions {
  exportData: (ctx: BotContext, menuMessageId: number) => Promise<void>;
  resetMemory: (ctx: BotContext, menuMessageId: number) => Promise<void>;
  // ... rest stays the same
```

- [ ] **Step 2: Add `confirm_reset` submenu in `buildMenus`**

In the user menus section of `buildMenus`, add after `chatSettings` and before `requestDataAccessMenu`:

```typescript
const confirmReset = new Menu<BotContext>('confirm_reset')
  .text('✅ Да, сбросить', async (ctx) => {
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (messageId) {
      await ctx.editMessageText('⏳ Сбрасываю память...');
    }
    await actions.resetMemory(ctx, messageId ?? 0);
  })
  .row()
  .back('❌ Отмена');
```

- [ ] **Step 3: Change user menu "Сбросить память" to submenu navigation**

Replace the reset memory button in `userMenu`:

```typescript
const userMenu = new Menu<BotContext>('user_menu')
  .text('📊 Загрузить данные', async (ctx) => {
    // ... existing export handler stays
  })
  .row()
  .submenu('🔄 Сбросить память', 'confirm_reset', async (ctx) => {
    await ctx.editMessageText(
      '⚠️ Вы уверены, что хотите сбросить память диалога? Это действие необратимо.'
    );
  })
  .row()
  .submenu('⚙️ Настройки чата', 'chat_settings');
```

- [ ] **Step 4: Register `confirmReset` under `userMenu`**

Update the register call:

```typescript
userMenu.register([chatSettings, confirmReset, requestDataAccessMenu]);
```

- [ ] **Step 5: Update return type of `buildMenus` to include `confirmReset`**

No change needed — `confirmReset` is registered under `userMenu`, not returned separately.

- [ ] **Step 6: Update `handleResetMemory` in `MainService.ts`**

Replace the existing method:

```typescript
  private async handleResetMemory(
    ctx: BotContext,
    menuMessageId: number
  ): Promise<void> {
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

    try {
      await this.memories.reset(chatId);
      if (menuMessageId) {
        await ctx.api.deleteMessage(chatId, menuMessageId).catch(() => {});
      }
      await ctx.reply('✅ Память сброшена\nВыберите действие:', {
        reply_markup: this.userMenuRef,
      });
    } catch (error) {
      this.logger.error({ error, chatId }, 'Failed to reset memory');
      if (menuMessageId) {
        await ctx.api
          .editMessageText(chatId, menuMessageId, '❌ Ошибка при сбросе памяти.')
          .catch(() => {});
      }
      await ctx.reply('❌ Ошибка при сбросе памяти. Попробуйте позже.');
    }
  }
```

Note: `this.userMenuRef` requires storing the menu reference. Instead, we can take a simpler approach — just use `ctx.reply` with a text confirmation and not re-send the menu (the user can always type /menu). Update to:

```typescript
  private async handleResetMemory(
    ctx: BotContext,
    menuMessageId: number
  ): Promise<void> {
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

    try {
      await this.memories.reset(chatId);
      if (menuMessageId) {
        await ctx.api
          .editMessageText(chatId, menuMessageId, '✅ Память сброшена!')
          .catch(() => {});
      } else {
        await ctx.reply('✅ Память сброшена!');
      }
    } catch (error) {
      this.logger.error({ error, chatId }, 'Failed to reset memory');
      if (menuMessageId) {
        await ctx.api
          .editMessageText(chatId, menuMessageId, '❌ Ошибка при сбросе памяти.')
          .catch(() => {});
      } else {
        await ctx.reply('❌ Ошибка при сбросе памяти. Попробуйте позже.');
      }
    }
  }
```

- [ ] **Step 7: Update `actions` object in `MainService` constructor**

Update the actions wiring to pass `menuMessageId`:

```typescript
    const actions: Actions = {
      exportData: (ctx: BotContext, menuMessageId: number) =>
        this.handleExportData(ctx, menuMessageId),
      resetMemory: (ctx: BotContext, menuMessageId: number) =>
        this.handleResetMemory(ctx, menuMessageId),
      // ... rest stays the same
```

- [ ] **Step 8: Build to verify no type errors**

Run: `npm run type:check`
Expected: no errors

- [ ] **Step 9: Run tests**

Run: `npm test`
Expected: all pass (may need to update `MainService.test.ts` mock for new `resetMemory` signature)

- [ ] **Step 10: Commit**

```bash
git add src/view/telegram/routes.ts src/view/telegram/MainService.ts
git commit -m "feat: add memory reset confirmation submenu with progress feedback"
```

---

### Task 7: Implement export data progress with editMessageText

**Files:**

- Modify: `src/view/telegram/MainService.ts` (rewrite `handleExportData`)
- Modify: `src/view/telegram/routes.ts` (update export button handler to pass `menuMessageId`)

- [ ] **Step 1: Update the export button handler in `routes.ts` (user menu)**

In the `userMenu` definition, update the "Загрузить данные" handler:

```typescript
const userMenu = new Menu<BotContext>('user_menu').text(
  '📊 Загрузить данные',
  async (ctx) => {
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
      await ctx.editMessageText(
        '❌ У вас нет доступа к данным этого чата.\n\nДля получения доступа обратитесь к администратору.',
        { reply_markup: requestDataAccessMenu }
      );
      return;
    }
    const menuMessageId = ctx.callbackQuery?.message?.message_id ?? 0;
    await actions.exportData(ctx, menuMessageId);
  }
);
```

- [ ] **Step 2: Update the export button handler in `routes.ts` (admin menu)**

In the `adminMenu` definition, update the handler:

```typescript
const adminMenu = new Menu<BotContext>('admin_menu').text(
  '📊 Загрузить данные',
  async (ctx) => {
    const menuMessageId = ctx.callbackQuery?.message?.message_id ?? 0;
    await actions.exportData(ctx, menuMessageId);
  }
);
```

- [ ] **Step 3: Rewrite `handleExportData` in `MainService.ts`**

Replace the existing method:

```typescript
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
        await ctx.api.editMessageText(chatId, menuMessageId, text);
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
        await editProgress('Нет данных для экспорта.');
        return;
      }

      const total = files.length;
      await editProgress(`📦 Загружено 0/${total}...`);

      for (let i = 0; i < files.length; i++) {
        await ctx.replyWithDocument(
          new InputFile(files[i].buffer, files[i].filename)
        );
        await editProgress(`📦 Загружено ${i + 1}/${total}...`);
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
      await editProgress('❌ Ошибка при загрузке данных.');
    }
  }
```

- [ ] **Step 4: Build to verify no type errors**

Run: `npm run type:check`
Expected: no errors

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all pass (may need to update `MainService.test.ts` mock for new `exportData` signature)

- [ ] **Step 6: Commit**

```bash
git add src/view/telegram/routes.ts src/view/telegram/MainService.ts
git commit -m "feat: add export progress indicator with editMessageText and menu cleanup"
```

---

### Task 8: Fix tests and final verification

**Files:**

- Modify: `test/MainService.test.ts` (update mocks if needed for new `exportData`/`resetMemory` signatures)

- [ ] **Step 1: Run full test suite**

Run: `npm test`

If tests fail due to changed `Actions` interface (new signature for `exportData`/`resetMemory`), update the mock `actions` in the test to match:

In `test/MainService.test.ts`, the `createMockBot` already returns a mock with `use`, `on`, `command` — the test creates `MainService` which calls `setupBotRouting`. The mock bot's `use`/`command`/`on` are `vi.fn()` stubs, so they accept anything. If the test calls `handleExportData` or `handleResetMemory` directly (unlikely since they're private), update accordingly.

- [ ] **Step 2: Run type check**

Run: `npm run type:check`
Expected: no errors

- [ ] **Step 3: Run lint and format**

Run: `npm run lint:fix && npm run format:fix`
Expected: clean

- [ ] **Step 4: Run full test suite one more time**

Run: `npm test`
Expected: all pass

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: update tests and formatting for menu UX improvements"
```

---

## Summary of Changes

| Task | What                                               | Files                         |
| ---- | -------------------------------------------------- | ----------------------------- |
| 1    | Fix admin permission check (`from.id` → `chat.id`) | `routes.ts`                   |
| 2    | Add `waitForInputOrCancel` helper                  | `routes.ts`                   |
| 3    | Rewrite user conversations with cancel + cleanup   | `routes.ts`                   |
| 4    | Rewrite admin conversations with cancel + cleanup  | `routes.ts`                   |
| 5    | Wire menu refs to conversations                    | `routes.ts`                   |
| 6    | Add memory reset confirmation submenu              | `routes.ts`, `MainService.ts` |
| 7    | Export data progress with editMessageText          | `routes.ts`, `MainService.ts` |
| 8    | Fix tests and final verification                   | `test/MainService.test.ts`    |
