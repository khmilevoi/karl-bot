# Migration Design: telegraf → grammyjs

**Date:** 2026-05-27  
**Strategy:** Big bang (single branch, all at once)  
**Goal:** Replace telegraf and custom inline-router with grammy + official plugins, removing ~8 files of hand-rolled routing infrastructure.

---

## Summary

The project currently uses `telegraf` v4.16.3 and a fully custom inline-router system (`src/view/telegram/inline-router/`, ~10 files, ~700 lines). This system implements state management, mutex concurrency, navigation stack, text-input waiting, and rendering. All of this functionality is available in the grammyjs ecosystem as maintained official plugins.

The migration replaces:

- `telegraf` → `grammy`
- Custom `inline-router` → `@grammyjs/menu` + `@grammyjs/conversations`
- Custom `StateStore`/`TokenStore` → `@grammyjs/session` (MemorySessionStorage)
- Custom `SimpleMutex` → removed (grammy handles concurrency via session middleware)

The Clean Architecture layers (domain, application, infrastructure) are largely untouched. Only `Context` import paths change in triggers and extractors.

---

## Section 1: Dependencies

### Remove

- `telegraf` (production dependency)

### Add

- `grammy` — core bot framework
- `@grammyjs/menu` — interactive inline keyboard menus with submenu/back navigation
- `@grammyjs/conversations` — sequential text input flows (replaces `onText` + `awaitingTextRouteId`)
- `@grammyjs/session` — session middleware with MemorySessionStorage

### Note on versions

At time of writing (2026-05-27), check npm for latest stable versions before installing.

---

## Section 2: Deleted Files

The entire `src/view/telegram/inline-router/` directory is deleted:

- `router.ts` — custom router factory
- `runtime.ts` — handler registration and state machine
- `render.ts` — message rendering and edit/replace logic
- `stores.ts` — StateStore and TokenStore interfaces + implementations
- `mutex.ts` — SimpleMutex concurrency primitive
- `helpers.ts` — `route()`, `button()`, `branch()` helper functions
- `utils.ts` — utility helpers
- `types.ts` — Route, Button, RouterState, RunningRouter, etc.
- `errors.ts` — custom error types
- `defaults.ts` — default options
- `index.ts` — barrel export

---

## Section 3: Rewritten Files

### `src/view/telegram/TelegramMessenger.ts`

Replace `Telegraf` with `Bot` from grammy. Install session, conversations, and menu middleware on the bot instance. The `ChatMessenger` interface surface (`launch()`, `stop()`, `sendMessage()`) stays the same.

```typescript
import { Bot } from 'grammy';
import { conversations } from '@grammyjs/conversations';
import { session } from '@grammyjs/session';
// ...

this.bot = new Bot(token);
this.bot.use(session({ initial: () => ({}) }));
this.bot.use(conversations());
```

**API differences to handle:**

- `bot.launch()` → `bot.start()` (grammy uses `.start()` for long polling)
- `bot.telegram.deleteWebhook()` → `bot.api.deleteWebhook()`
- `bot.telegram.sendMessage()` → `bot.api.sendMessage()`
- `bot.telegram.sendChatAction()` → `bot.api.sendChatAction()`
- `bot.telegram.deleteMessage()` → `bot.api.deleteMessage()`
- `bot.stop()` → same in grammy, used for graceful shutdown

### `src/view/telegram/routes.ts`

Full rewrite. The current DSL (`route()`, `button()`, `navigate()`, `createRouter()`) is replaced with native grammy patterns.

**Static menus** (AdminMenu, UserMenu, AdminChats, AdminChat, ChatSettings, etc.) → `new Menu("id")` chain:

```typescript
const adminMenu = new Menu<MyContext>('admin_menu')
  .text('📊 Загрузить данные', (ctx) => actions.exportData(ctx))
  .row()
  .submenu('💬 Управление чатами', 'admin_chats');
```

**Submenu navigation** → grammy's built-in `.submenu()` / `.back()`:

```typescript
const adminChats = new Menu<MyContext>('admin_chats')
  // dynamic buttons built in .dynamic()
  .back('← Назад');
adminMenu.register(adminChats);
```

**Text input steps** (HistoryLimit, InterestInterval, TopicTime, Timezone) → `@grammyjs/conversations`:

```typescript
async function setHistoryLimitConvo(
  conversation: MyConversation,
  ctx: MyContext
) {
  await ctx.reply('Введите новый лимит истории (от 1 до 50):');
  const response = await conversation.waitFor(':text');
  const limit = parseInt(response.msg.text, 10);
  await actions.setHistoryLimit(ctx.chat!.id, limit, false);
}
bot.use(createConversation(setHistoryLimitConvo));
```

**Commands** (`/menu`, `/start`) → `bot.command()`:

```typescript
bot.command(['menu', 'start'], async (ctx) => {
  await ctx.reply('Главное меню:', {
    reply_markup: isAdmin ? adminMenu : userMenu,
  });
});
```

**`my_chat_member` handling** → `bot.on("my_chat_member", ...)`.

**Text message handling** (triggers pipeline) → `bot.on("message:text", ...)`.

### `src/view/telegram/MainService.ts`

- Import `Bot` from `grammy` instead of `Telegraf`
- Remove `RunningRouter`, `setupBotRouting`, `createRouter` imports
- Remove router initialization in constructor
- Keep `withTyping()` helper unchanged
- Bot configuration (commands, handlers) moved to a `configure()` method using grammy API

### `src/application/interfaces/chat/ChatMessenger.ts`

Change `bot` property type from `Telegraf` to `Bot` (grammy).

---

## Section 4: Partial Changes (Import Only)

The following files only need their `Context` import changed from `telegraf` to `grammy`. No logic changes:

- `src/view/telegram/triggers/MentionTrigger.ts`
- `src/view/telegram/triggers/ReplyTrigger.ts`
- `src/view/telegram/triggers/NameTrigger.ts`
- `src/view/telegram/triggers/InterestTrigger.ts`
- `src/application/use-cases/messages/MessageFactory.ts` (if it uses telegraf Context)
- `src/application/use-cases/messages/MessageContextExtractor.ts` (if it uses telegraf Context)

Verify that property access patterns (`ctx.message`, `ctx.from`, `ctx.chat`) are compatible — grammy mirrors telegraf's context shape for core properties.

---

## Section 5: Container Changes (`src/container.ts`)

- Remove any Telegraf-specific bindings
- The `TelegramMessenger` binding remains, but its constructor now creates `Bot` (grammy) internally
- No new tokens needed — grammy middleware is configured inside `TelegramMessenger`

---

## Section 6: Testing

- Update test mocks: replace `telegraf` `Context` mocks with grammy `Context` mocks
- Trigger tests (MentionTrigger, etc.) — mock grammy Context with same shape
- No inline-router tests to migrate (they are deleted along with the router)
- Add basic smoke tests for the new menu structure if time permits

---

## What Stays Unchanged

- `src/domain/` — all domain entities and trigger types
- `src/application/` — all use-cases, services, interfaces (except ChatMessenger bot type)
- `src/infrastructure/` — SQLite repositories, OpenAI integration, config
- `src/index.ts` — application bootstrap
- Inversify DI container structure

---

## Migration Checklist (for implementation plan)

1. Install grammy packages, remove telegraf
2. Rewrite `TelegramMessenger.ts` with grammy `Bot`
3. Update `ChatMessenger` interface type
4. Delete `src/view/telegram/inline-router/` directory
5. Rewrite `src/view/telegram/routes.ts` using `@grammyjs/menu`
6. Add conversation handlers for text-input flows using `@grammyjs/conversations`
7. Rewrite `MainService.ts` — remove router, add grammy handler setup
8. Update `Context` imports in triggers and extractors
9. Update container bindings
10. Update/fix tests
11. Build and type-check: `npm run build && npm run type:check`
12. Lint fix: `npm run lint:fix && npm run format:fix`
