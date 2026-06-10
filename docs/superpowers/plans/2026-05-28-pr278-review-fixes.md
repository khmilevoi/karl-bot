# PR #278 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 10 findings from the PR #278 code review (telegraf → grammy migration): code bugs, menu-state correctness, repo hygiene, and missing test coverage.

**Architecture:** Surgical edits to `src/view/telegram/routes.ts` and `src/view/telegram/MainService.ts`, plus `.gitignore` hygiene. Menu state after an action follows the codebase's existing pattern — delete the stale menu message and send a fresh one with the menu attached — via a new `sendMainMenu` helper. Data operations stay in `MainService`; menu UI lives in `routes.ts`.

**Tech Stack:** TypeScript, grammy v1.43, @grammyjs/menu, @grammyjs/conversations, Vitest, ESLint/Prettier.

**Note:** This plan and its spec are **local-only** — Task 1 adds `docs/superpowers/` to `.gitignore`. Never `git add` the plan/spec files. Every `git add` in this plan lists explicit paths.

**Reference spec:** `docs/superpowers/specs/2026-05-28-pr278-review-fixes-design.md`

---

## File Map

| Action | File | Findings |
| ------ | ---- | -------- |
| Modify | `.gitignore` | C7, C8 |
| Untrack | `.claude/settings.local.json`, `docs/superpowers/plans/*`, `docs/superpowers/specs/*` | C7, C8 |
| Modify | `src/view/telegram/routes.ts` | A1, A2, A3, B4, B5, B6, D1, D2 |
| Modify | `src/view/telegram/MainService.ts` | A10, B4, B-export |
| Create | `test/routes.test.ts` | D1, D2, A1 |
| Modify | `test/MainService.test.ts` | D3, D4 |

---

## Task 1: Repo hygiene — re-ignore `.claude` and `docs/superpowers`

**Files:**
- Modify: `.gitignore`
- Untrack: `.claude/settings.local.json`, `docs/superpowers/plans/`, `docs/superpowers/specs/`

- [ ] **Step 1: Inspect current `.gitignore`**

Run: `rtk read .gitignore`
Expected: the file no longer contains a `.claude` line (the PR removed it).

- [ ] **Step 2: Add ignore entries**

Append these two lines to `.gitignore` (keep existing content above). If a `.claude` line already exists, do not duplicate it.

```gitignore
.claude
docs/superpowers/
```

- [ ] **Step 3: Untrack the committed local-only files**

Run:
```bash
git rm --cached .claude/settings.local.json
git rm -r --cached docs/superpowers/plans docs/superpowers/specs
```
Expected: git lists the removed (cached) paths. Files remain on disk. Untracked files in those dirs (this plan + its spec) are unaffected.

- [ ] **Step 4: Verify the local-only files are now ignored**

Run: `rtk git status`
Expected: `.gitignore` modified; the `.claude/settings.local.json` and `docs/superpowers/...` files appear as deletions staged; the new plan/spec under `docs/superpowers/` do NOT appear (ignored). No source files changed.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .claude/settings.local.json docs/superpowers/plans docs/superpowers/specs
git commit -m "chore: stop tracking .claude and docs/superpowers"
```
Note: `git add` of removed paths records the deletions. The ignored new files won't be added.
Expected: commit succeeds; pre-commit hooks pass.

---

## Task 2: Refactor `waitForInputOrCancel` return type + remove dead code (A2, A3)

`waitForInputOrCancel` returns the validated value directly (`T | null`) instead of an `InputResult<T>` whose `userMessageId`/`promptMessageId` were always deleted before return. The retry loop becomes a bounded `for` loop with no unreachable `return`.

**Files:**
- Modify: `src/view/telegram/routes.ts`
- Create: `test/routes.test.ts`

- [ ] **Step 1: Write the failing test for `waitForInputOrCancel`**

Create `test/routes.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

import {
  CANCEL_DATA,
  waitForInputOrCancel,
} from '../src/view/telegram/routes';
import type { BotContext } from '../src/view/telegram/context';

const makeCtx = () =>
  ({
    chat: { id: 100 },
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
  }) as unknown as BotContext;

const textUpdate = (text: string, id = 9) => ({
  callbackQuery: undefined,
  message: { text, message_id: id },
  hasCallbackQuery: () => false,
  has: () => true,
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
});

const cancelUpdate = () => ({
  callbackQuery: { data: CANCEL_DATA },
  message: undefined,
  hasCallbackQuery: () => true,
  has: () => false,
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
});

const toNum = (text: string): number | null => {
  const n = parseInt(text, 10);
  return !isNaN(n) && n >= 1 && n <= 50 ? n : null;
};

describe('waitForInputOrCancel', () => {
  it('returns the validated value on valid input', async () => {
    const ctx = makeCtx();
    const conversation = {
      waitUntil: vi.fn().mockResolvedValue(textUpdate('5')),
    } as any;

    const result = await waitForInputOrCancel(conversation, ctx, 'prompt', toNum);

    expect(result).toBe(5);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('returns null when cancelled', async () => {
    const ctx = makeCtx();
    const update = cancelUpdate();
    const conversation = { waitUntil: vi.fn().mockResolvedValue(update) } as any;

    const result = await waitForInputOrCancel(conversation, ctx, 'prompt', toNum);

    expect(result).toBeNull();
    expect(update.answerCallbackQuery).toHaveBeenCalledWith('Отменено');
  });

  it('retries once on invalid input then accepts a valid value', async () => {
    const ctx = makeCtx();
    const conversation = {
      waitUntil: vi
        .fn()
        .mockResolvedValueOnce(textUpdate('abc'))
        .mockResolvedValueOnce(textUpdate('7')),
    } as any;

    const result = await waitForInputOrCancel(conversation, ctx, 'prompt', toNum);

    expect(result).toBe(7);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns null after two invalid attempts', async () => {
    const ctx = makeCtx();
    const conversation = {
      waitUntil: vi.fn().mockResolvedValue(textUpdate('abc')),
    } as any;

    const result = await waitForInputOrCancel(conversation, ctx, 'prompt', toNum);

    expect(result).toBeNull();
    expect(ctx.api.sendMessage).toHaveBeenLastCalledWith(
      100,
      'Слишком много попыток. Возвращаюсь в меню.'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- routes`
Expected: FAIL — `CANCEL_DATA` and/or `waitForInputOrCancel` are not exported, and the current function returns an `InputResult` object (so `expect(result).toBe(5)` fails).

- [ ] **Step 3: Remove the `InputResult` interface and export `CANCEL_DATA`**

In `src/view/telegram/routes.ts`, delete this block:

```typescript
interface InputResult<T> {
  value: T;
  userMessageId: number;
  promptMessageId: number;
}

const CANCEL_DATA = 'cancel_conversation';
```

Replace it with:

```typescript
export const CANCEL_DATA = 'cancel_conversation';
```

- [ ] **Step 4: Rewrite `waitForInputOrCancel` to return `T | null`**

Replace the entire current function:

```typescript
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

with:

```typescript
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
```

- [ ] **Step 5: Update all six conversation callers to use the returned value directly**

In `makeConversations`, replace each `result.value` / `timeResult.value` / `tzResult.value` with the bare variable. Concretely:

`adminHistoryLimit`:
```typescript
    if (result === null) return;

    await actions.setHistoryLimit(chatId, result, true);
```

`adminInterestInterval`:
```typescript
    if (result === null) return;

    await actions.setInterestInterval(chatId, result, true);
```

`adminTopicTime` (the final block):
```typescript
    if (tzResult === null) return;

    await actions.setTopicTime(chatId, timeResult, tzResult);
    await ctx.api.sendMessage(
      adminChatId,
      `✅ Время ${timeResult} (${tzResult}) установлено`,
      { reply_markup: menuRefs.adminChat.menu }
    );
```

`userHistoryLimit`:
```typescript
    if (result === null) return;

    await actions.setHistoryLimit(chatId, result, false);
```

`userInterestInterval`:
```typescript
    if (result === null) return;

    await actions.setInterestInterval(chatId, result, false);
```

`userTopicTime` (the final block):
```typescript
    if (tzResult === null) return;

    await actions.setTopicTime(chatId, timeResult, tzResult);
    await ctx.api.sendMessage(
      chatId,
      `✅ Время ${timeResult} (${tzResult}) установлено`,
      { reply_markup: menuRefs.chatSettings.menu }
    );
```

- [ ] **Step 6: Run tests, type check, lint/format**

Run: `npm test -- routes`
Expected: PASS (4 tests).

Run: `npm run type:check`
Expected: no errors.

Run: `npm run lint:fix && npm run format:fix`
Expected: clean / auto-fixed.

- [ ] **Step 7: Commit**

```bash
git add src/view/telegram/routes.ts test/routes.test.ts
git commit -m "refactor: simplify waitForInputOrCancel to return value and remove dead code"
```

---

## Task 3: Fix `adminTopicTime` stale ctx (A1) + export `makeConversations` + regression test

**Files:**
- Modify: `src/view/telegram/routes.ts`
- Modify: `test/routes.test.ts`

- [ ] **Step 1: Export `makeConversations`**

In `src/view/telegram/routes.ts`, change:

```typescript
function makeConversations(
```
to:
```typescript
export function makeConversations(
```

- [ ] **Step 2: Write the failing regression test**

Append to `test/routes.test.ts`:

```typescript
import { makeConversations } from '../src/view/telegram/routes';
import type { Actions } from '../src/view/telegram/routes';

describe('adminTopicTime conversation', () => {
  it('reads selectedChatId from the replayed conversation context', async () => {
    const setTopicTime = vi.fn().mockResolvedValue(undefined);
    const actions = { setTopicTime } as unknown as Actions;
    const menuRefs = {
      chatSettings: { menu: {} as any, title: '' },
      adminChat: { menu: {} as any, title: '' },
    };
    const convs = makeConversations(actions, menuRefs);

    const outerCtx = {
      chat: { id: 100 },
      session: {},
      api: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as BotContext;

    const replayedCtx = { session: { selectedChatId: 42 } };
    const conversation = {
      external: vi.fn(async (fn: (c: any) => unknown) => fn(replayedCtx)),
      waitUntil: vi
        .fn()
        .mockResolvedValueOnce(textUpdate('09:00'))
        .mockResolvedValueOnce(textUpdate('UTC+03')),
    } as any;

    await convs.adminTopicTime(conversation, outerCtx);

    expect(setTopicTime).toHaveBeenCalledWith(42, '09:00', 'UTC+03');
  });
});
```

(Move the duplicate `import { makeConversations ... }` into the existing import block at the top of the file if your linter flags duplicate imports — combine with the `waitForInputOrCancel` import. Keep a single import statement from `'../src/view/telegram/routes'`.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- routes`
Expected: FAIL — with the current `external(() => ctx.session?.selectedChatId)`, the callback ignores the replayed ctx and reads `outerCtx.session.selectedChatId` (undefined), so `assert(chatId, 'No selected chat')` throws before `setTopicTime` is called.

- [ ] **Step 4: Fix the stale ctx**

In `adminTopicTime`, change:

```typescript
    const chatId = await conversation.external(
      () => ctx.session?.selectedChatId
    );
```
to:
```typescript
    const chatId = await conversation.external(
      (ctx) => ctx.session?.selectedChatId
    );
```

- [ ] **Step 5: Run tests + type check**

Run: `npm test -- routes`
Expected: PASS (all routes tests).

Run: `npm run type:check`
Expected: no errors.

- [ ] **Step 6: Lint/format and commit**

```bash
git add src/view/telegram/routes.ts test/routes.test.ts
```
Run: `npm run lint:fix && npm run format:fix`
```bash
git commit -m "fix: read selectedChatId from replayed conversation context in adminTopicTime"
```

---

## Task 4: Reset flow re-renders menu (B4, B6)

`resetMemory` becomes a pure data operation returning a status; the `confirm_reset` "Да" handler deletes the confirmation message and sends a fresh main menu. Add module-level menu-title constants and a `sendMainMenu` helper.

**Files:**
- Modify: `src/view/telegram/MainService.ts`
- Modify: `src/view/telegram/routes.ts`
- Modify: `test/MainService.test.ts`

- [ ] **Step 1: Write failing tests for the new `handleResetMemory` contract**

In `test/MainService.test.ts`, add a service factory near the top (after the imports, before `describe`) so new tests are DRY:

```typescript
const makeDeps = (over: Partial<Record<string, unknown>> = {}) => ({
  memories: { get: vi.fn(), reset: vi.fn().mockResolvedValue(undefined) },
  admin: {
    hasAccess: vi.fn().mockResolvedValue(true),
    exportTables: vi.fn().mockResolvedValue([]),
    exportChatData: vi.fn().mockResolvedValue([]),
    createAccessKey: vi.fn(),
  },
  approval: {
    getStatus: vi.fn().mockResolvedValue('approved'),
    pending: vi.fn(),
    approve: vi.fn(),
    ban: vi.fn(),
    unban: vi.fn(),
    listAll: vi.fn().mockResolvedValue([]),
  },
  extractor: { extract: vi.fn() },
  pipeline: { shouldRespond: vi.fn() },
  responder: { generate: vi.fn() },
  chatInfo: { getChat: vi.fn() },
  config: {
    getConfig: vi.fn().mockResolvedValue({
      historyLimit: 50,
      interestInterval: 25,
      topicTime: null,
      topicTimezone: 'UTC',
    }),
    setHistoryLimit: vi.fn(),
    setInterestInterval: vi.fn(),
    setTopicTime: vi.fn(),
  },
  scheduler: { start: vi.fn().mockResolvedValue(undefined) },
  ...over,
});

const buildService = (deps: ReturnType<typeof makeDeps>) =>
  new MainService(
    new MockEnvService() as unknown as EnvService,
    deps.memories as unknown as ChatMemoryManager,
    deps.admin as unknown as AdminService,
    deps.approval as unknown as ChatApprovalService,
    deps.extractor as unknown as MessageContextExtractor,
    deps.pipeline as unknown as TriggerPipeline,
    deps.responder as unknown as ChatResponder,
    deps.chatInfo as unknown as ChatInfoService,
    deps.config as unknown as ChatConfigService,
    createLoggerFactory(),
    deps.scheduler as unknown as TopicOfDayScheduler,
    createMockMessenger()
  );
```

Then add this describe block at the end of the file:

```typescript
describe('MainService.handleResetMemory', () => {
  it('returns "denied" without resetting when a non-admin lacks access', async () => {
    const deps = makeDeps();
    deps.admin.hasAccess = vi.fn().mockResolvedValue(false);
    const service = buildService(deps);

    const ctx = { chat: { id: 2 }, from: { id: 5 } } as unknown as BotContext;
    const result = await (service as any).handleResetMemory(ctx);

    expect(result).toBe('denied');
    expect(deps.memories.reset).not.toHaveBeenCalled();
  });

  it('resets and returns "ok" for an authorized user', async () => {
    const deps = makeDeps();
    deps.admin.hasAccess = vi.fn().mockResolvedValue(true);
    const service = buildService(deps);

    const ctx = { chat: { id: 2 }, from: { id: 5 } } as unknown as BotContext;
    const result = await (service as any).handleResetMemory(ctx);

    expect(result).toBe('ok');
    expect(deps.memories.reset).toHaveBeenCalledWith(2);
  });

  it('skips the access check for the admin chat', async () => {
    const deps = makeDeps();
    const service = buildService(deps);

    const ctx = { chat: { id: 1 }, from: { id: 5 } } as unknown as BotContext;
    const result = await (service as any).handleResetMemory(ctx);

    expect(result).toBe('ok');
    expect(deps.admin.hasAccess).not.toHaveBeenCalled();
    expect(deps.memories.reset).toHaveBeenCalledWith(1);
  });
});
```

Add the `BotContext` import to the test file if missing:
```typescript
import type { BotContext } from '../src/view/telegram/context';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- MainService`
Expected: FAIL — current `handleResetMemory(ctx, menuMessageId)` returns `void`, so `expect(result).toBe('ok')` fails.

- [ ] **Step 3: Rewrite `handleResetMemory` as a pure data op**

In `src/view/telegram/MainService.ts`, replace the whole method:

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
          .editMessageText(
            chatId,
            menuMessageId,
            '❌ Ошибка при сбросе памяти.'
          )
          .catch(() => {});
      } else {
        await ctx.reply('❌ Ошибка при сбросе памяти. Попробуйте позже.');
      }
    }
  }
```

with:

```typescript
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
      await this.memories.reset(chatId);
      return 'ok';
    } catch (error) {
      this.logger.error({ error, chatId }, 'Failed to reset memory');
      return 'error';
    }
  }
```

- [ ] **Step 4: Update the `Actions` interface and wiring for `resetMemory`**

In `src/view/telegram/routes.ts`, change the `Actions` member:

```typescript
  resetMemory: (ctx: BotContext, menuMessageId: number) => Promise<void>;
```
to:
```typescript
  resetMemory: (ctx: BotContext) => Promise<'ok' | 'denied' | 'error'>;
```

In `src/view/telegram/MainService.ts`, change the wiring:

```typescript
      resetMemory: (ctx: BotContext, menuMessageId: number) =>
        this.handleResetMemory(ctx, menuMessageId),
```
to:
```typescript
      resetMemory: (ctx: BotContext) => this.handleResetMemory(ctx),
```

- [ ] **Step 5: Add menu-title constants**

In `src/view/telegram/routes.ts`, add after the imports (before the `Actions` interface):

```typescript
export const ADMIN_MENU_TITLE = 'Панель администратора\nВыберите действие:';
export const USER_MENU_TITLE = 'Главное меню\nВыберите действие:';
```

- [ ] **Step 6: Add the `sendMainMenu` helper inside `buildMenus`**

In `buildMenus`, add this function declaration at the top of the function body (right after the opening `// ── Admin menus ───` comment is fine — it is hoisted and resolves `adminMenu`/`userMenu` at call time):

```typescript
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
```

- [ ] **Step 7: Rewrite the `confirm_reset` menu**

Replace:

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

with:

```typescript
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
```

- [ ] **Step 8: Run tests, type check, lint/format**

Run: `npm test -- MainService`
Expected: PASS (3 new reset tests + existing 3).

Run: `npm run type:check`
Expected: no errors.

Run: `npm run lint:fix && npm run format:fix`

- [ ] **Step 9: Commit**

```bash
git add src/view/telegram/MainService.ts src/view/telegram/routes.ts test/MainService.test.ts
git commit -m "fix: re-render main menu after memory reset"
```

---

## Task 5: Export access-denied edits in place + re-attach menu + setImmediate comment (B5, B-export, A10)

**Files:**
- Modify: `src/view/telegram/routes.ts`
- Modify: `src/view/telegram/MainService.ts`
- Modify: `test/MainService.test.ts`

- [ ] **Step 1: Write failing tests for `handleExportData`**

Append to `test/MainService.test.ts`:

```typescript
describe('MainService.handleExportData', () => {
  const makeExportCtx = () =>
    ({
      chat: { id: 2 },
      from: { id: 5 },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      replyWithDocument: vi.fn().mockResolvedValue(undefined),
      api: {
        editMessageText: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
      },
    }) as unknown as BotContext;

  it('reports no data when there are no files', async () => {
    const deps = makeDeps();
    deps.admin.exportChatData = vi.fn().mockResolvedValue([]);
    const service = buildService(deps);
    const ctx = makeExportCtx();

    await (service as any).handleExportData(ctx, 10);

    expect(ctx.replyWithDocument).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('Нет данных для экспорта.');
  });

  it('sends each file and updates progress', async () => {
    const deps = makeDeps();
    deps.admin.exportChatData = vi.fn().mockResolvedValue([
      { buffer: Buffer.from('a'), filename: 'a.csv' },
      { buffer: Buffer.from('b'), filename: 'b.csv' },
    ]);
    const service = buildService(deps);
    const ctx = makeExportCtx();

    await (service as any).handleExportData(ctx, 10);

    expect(ctx.replyWithDocument).toHaveBeenCalledTimes(2);
    expect(ctx.api.editMessageText).toHaveBeenCalled();
  });

  it('reports an error when export throws', async () => {
    const deps = makeDeps();
    deps.admin.exportChatData = vi.fn().mockRejectedValue(new Error('boom'));
    const service = buildService(deps);
    const ctx = makeExportCtx();

    await (service as any).handleExportData(ctx, 10);

    expect(ctx.reply).toHaveBeenCalledWith('❌ Ошибка при загрузке данных.');
  });
});
```

- [ ] **Step 2: Run tests to verify the new file is exercised**

Run: `npm test -- MainService`
Expected: these three tests should PASS against the current `handleExportData` (behavior is unchanged so far). If any fail, fix the test mocks before proceeding — do not change `handleExportData` behavior except per Step 3.

- [ ] **Step 3: Add the `setImmediate` rationale comment (A10)**

In `handleExportData`, change:

```typescript
        await editProgress(`📦 Загружено ${i + 1}/${total}...`);
        await new Promise<void>((resolve) => setImmediate(resolve));
```
to:
```typescript
        await editProgress(`📦 Загружено ${i + 1}/${total}...`);
        // Yield to the event loop so bulk document sends don't block other updates
        await new Promise<void>((resolve) => setImmediate(resolve));
```

- [ ] **Step 4: Fix the export access-denied path (B5)**

In `src/view/telegram/routes.ts`, in the `userMenu` "Загрузить данные" handler, replace:

```typescript
      if (!hasAccess) {
        await ctx.reply(
          '❌ У вас нет доступа к данным этого чата.\n\nДля получения доступа обратитесь к администратору.',
          { reply_markup: requestDataAccessMenu }
        );
        return;
      }
      await actions.exportData(
        ctx,
        ctx.callbackQuery?.message?.message_id ?? 0
      );
```

with:

```typescript
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
```

- [ ] **Step 5: Re-attach the menu after admin export (B-export)**

In the `adminMenu` "Загрузить данные" handler, replace:

```typescript
  const adminMenu = new Menu<BotContext>('admin_menu')
    .text('📊 Загрузить данные', async (ctx) => {
      await actions.exportData(
        ctx,
        ctx.callbackQuery?.message?.message_id ?? 0
      );
    })
    .row()
    .submenu('💬 Управление чатами', 'admin_chats');
```

with:

```typescript
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
```

- [ ] **Step 6: Run tests, type check, lint/format**

Run: `npm test -- MainService`
Expected: PASS.

Run: `npm run type:check`
Expected: no errors.

Run: `npm run lint:fix && npm run format:fix`

- [ ] **Step 7: Commit**

```bash
git add src/view/telegram/routes.ts src/view/telegram/MainService.ts test/MainService.test.ts
git commit -m "fix: edit menu in place on export denial and re-render menu after export"
```

---

## Task 6: Admin/user routing test for /start (D2)

**Files:**
- Modify: `test/routes.test.ts`

- [ ] **Step 1: Write the routing test**

Append to `test/routes.test.ts`:

```typescript
import { setupBotRouting, ADMIN_MENU_TITLE, USER_MENU_TITLE } from '../src/view/telegram/routes';

describe('setupBotRouting /start routing', () => {
  const fullActions = (isAdmin: (id: number) => boolean): Actions =>
    ({
      isAdmin,
      exportData: vi.fn(),
      resetMemory: vi.fn(),
      getChats: vi.fn().mockResolvedValue([]),
      getChatData: vi.fn(),
      requestChatAccess: vi.fn(),
      requestUserAccess: vi.fn(),
      sendChatApprovalRequest: vi.fn(),
      sendUserNotification: vi.fn(),
      approveChat: vi.fn(),
      banChat: vi.fn(),
      unbanChat: vi.fn(),
      approveUser: vi.fn(),
      hasUserAccess: vi.fn(),
      getChatConfig: vi.fn(),
      setHistoryLimit: vi.fn(),
      setInterestInterval: vi.fn(),
      setTopicTime: vi.fn(),
      checkChatStatus: vi.fn(),
      processMessage: vi.fn(),
      log: vi.fn(),
    }) as unknown as Actions;

  const captureCommand = (actions: Actions) => {
    let commandHandler: (ctx: any) => Promise<void> = async () => {};
    const bot = {
      use: vi.fn(),
      command: vi.fn((_names: unknown, h: (ctx: any) => Promise<void>) => {
        commandHandler = h;
      }),
      callbackQuery: vi.fn(),
      on: vi.fn(),
    };
    setupBotRouting(bot as any, actions);
    return commandHandler;
  };

  it('shows the admin menu in the admin chat', async () => {
    const handler = captureCommand(fullActions(() => true));
    const ctx = { chat: { id: 1 }, reply: vi.fn().mockResolvedValue(undefined) };

    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      ADMIN_MENU_TITLE,
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });

  it('shows the user menu in a non-admin chat', async () => {
    const handler = captureCommand(fullActions(() => false));
    const ctx = { chat: { id: 9 }, reply: vi.fn().mockResolvedValue(undefined) };

    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      USER_MENU_TITLE,
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });
});
```

Combine the new `import` from `'../src/view/telegram/routes'` with the existing import statement at the top of the file (single import line — your linter forbids duplicate imports from the same module).

Note: the `/start` handler uses `menuRefs.adminMenu.title` / `menuRefs.userMenu.title`. Update `setupBotRouting`'s `menuRefs` to reference the new constants so the test assertions match:

In `setupBotRouting`, change:
```typescript
  const menuRefs = {
    userMenu: { menu: userMenu, title: 'Главное меню\nВыберите действие:' },
    adminMenu: {
      menu: adminMenu,
      title: 'Панель администратора\nВыберите действие:',
    },
    chatSettings: { menu: chatSettings, title: 'Настройки чата:' },
    adminChat: { menu: adminChat, title: 'Управление чатом:' },
  };
```
to:
```typescript
  const menuRefs = {
    userMenu: { menu: userMenu, title: USER_MENU_TITLE },
    adminMenu: { menu: adminMenu, title: ADMIN_MENU_TITLE },
    chatSettings: { menu: chatSettings, title: 'Настройки чата:' },
    adminChat: { menu: adminChat, title: 'Управление чатом:' },
  };
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test -- routes`
Expected: PASS (both routing tests). If `setupBotRouting` throws during setup, confirm the mock bot exposes `use`, `command`, `callbackQuery`, and `on`.

- [ ] **Step 3: Type check, lint/format**

Run: `npm run type:check`
Expected: no errors.

Run: `npm run lint:fix && npm run format:fix`

- [ ] **Step 4: Commit**

```bash
git add src/view/telegram/routes.ts test/routes.test.ts
git commit -m "test: cover admin/user menu routing for /start"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`
Expected: all tests pass, including the deleted-inline-router suites being gone and the new `routes.test.ts` / `MainService.test.ts` cases present.

- [ ] **Step 2: Type check**

Run: `npm run type:check`
Expected: no errors (no `any` leakage in source — test-only casts are acceptable).

- [ ] **Step 3: Lint + format check**

Run: `npm run lint && npm run format`
Expected: clean.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: successful RSBuild compile.

- [ ] **Step 5: Final status review**

Run: `rtk git status` and `rtk git log --oneline -8`
Expected: working tree clean; six fix/refactor/test/chore commits present; no `.claude` or `docs/superpowers` files tracked.

---

## Self-Review Notes

- **Spec coverage:** A1→Task 3; A2/A3→Task 2; A10→Task 5 Step 3; B4/B6→Task 4; B5→Task 5 Step 4; B-export→Task 5 Step 5; C7/C8→Task 1; D1→Task 2; D2→Task 6; D3→Task 5 Step 1; D4→Task 4 Step 1.
- **Deviation from spec (B-export):** `handleExportData` keeps its existing status replies (success/no-data/error); the route handlers append a fresh menu via `sendMainMenu`. This is simpler and lower-risk than moving outcome signalling into the controller. The spec's "drop the redundant success reply" is not implemented — the success reply remains, followed by the menu. Acceptable: the goal (a menu is always present after export) is met.
- **Type consistency:** `resetMemory` is `(ctx) => Promise<'ok' | 'denied' | 'error'>` in both the `Actions` interface (routes.ts) and the wiring/method (MainService.ts). `waitForInputOrCancel` returns `T | null` and all six callers use the bare value. `sendMainMenu(ctx, titleOverride?)` and `ADMIN_MENU_TITLE`/`USER_MENU_TITLE` are referenced consistently.
- **Local-only:** no task adds the plan or spec to git; Task 1 ignores `docs/superpowers/`.
