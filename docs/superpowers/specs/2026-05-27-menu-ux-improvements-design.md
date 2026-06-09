# Menu UX Improvements Design

## Summary

Improve the Telegram bot menu flow after the grammY migration. Focus: cancel buttons for conversations, message cleanup, export progress indicator, destructive action confirmation, proper admin/user menu routing.

## Context

The bot uses `@grammyjs/menu` and `@grammyjs/conversations` (grammY). It operates in group chats (bot may or may not have admin rights) and one private admin chat. Current issues: no way to cancel input prompts, messages pile up after interactions, no progress during export, no confirmation before memory reset, admin menu can leak into group chats.

## Approach

Conversations + editMessageText (Approach A). Keep `@grammyjs/conversations`, enhance each conversation with cancel support and cleanup. Use `editMessageText` to transform the menu message in-place rather than delete/create.

---

## Section 1: Conversations — Cancel and Cleanup

### Shared helper

Extract `waitForInputOrCancel(conversation, ctx, promptText, validator)`:

- Sends prompt message with text and inline `❌ Отмена` button
- Saves `message_id` of the prompt
- Uses `conversation.waitUntil()` accepting both `message:text` and `callback_query` with data `cancel`
- On cancel callback: delete prompt, send fresh settings menu, return `null`
- On text: validate with `validator`; if invalid — delete prompt, try delete user message (catch error), send error + new prompt with cancel button (one retry, then return to menu on second failure); if valid — return parsed value

### Per-conversation changes

All 6 conversations (adminHistoryLimit, adminInterestInterval, adminTopicTime, userHistoryLimit, userInterestInterval, userTopicTime) follow the same pattern:

1. **Enter**: call `waitForInputOrCancel` with appropriate prompt text and validator
2. **On cancel** (`null` returned): exit early
3. **On valid input**: apply setting, delete prompt message, try delete user's text message (graceful — catch errors since bot may lack admin rights in group), send new message with settings menu showing updated values
4. **Multi-step conversations** (topicTime — two inputs): chain two `waitForInputOrCancel` calls; if either returns `null`, abort

### Cancel button

Inline keyboard with single button: `{ text: '❌ Отмена', callback_data: 'cancel_conversation' }`. Sent alongside each prompt message as `reply_markup`.

### Message cleanup strategy

- Bot's own messages (prompts, confirmations): always delete via `deleteMessage` — bot can always delete its own messages
- User's text input: try `deleteMessage`, catch and ignore errors (bot may not have admin rights in group chats)

---

## Section 2: Export Data — Progress and Menu Update

### Flow

1. User clicks "Загрузить данные"
2. `editMessageText` on current menu message → "⏳ Подготовка данных..." (no buttons)
3. Fetch file list
4. If no files: editMessageText → "Нет данных для экспорта", pause, then delete message and send new menu
5. If files exist: editMessageText → "📦 Загружено 0/{total}..."
6. After each file sent: editMessageText → "📦 Загружено {i}/{total}..."
7. After all files: delete progress message, send new message with menu

### Error handling

- If `editMessageText` fails (message already deleted, etc.): continue export, send new menu at end
- If export itself fails: editMessageText → "❌ Ошибка при загрузке", then send new menu

### Access check (user menu)

- If user lacks access: editMessageText on menu → access denied message with `requestDataAccessMenu` (instead of current `ctx.reply`)

---

## Section 3: Memory Reset — Confirmation

### Implementation

New submenu `confirm_reset` registered under `user_menu`:

1. User clicks "Сбросить память"
2. Navigate to `confirm_reset` submenu: "⚠️ Вы уверены, что хотите сбросить память диалога? Это действие необратимо." with two buttons:
   - `✅ Да, сбросить` — execute reset
   - `❌ Отмена` — navigate back to `user_menu`

### On confirmation

1. editMessageText → "⏳ Сбрасываю память..."
2. Execute reset
3. Delete message, send new main menu with text "✅ Память сброшена"

### On cancel

Standard grammY menu navigation: `ctx.menu.nav('user_menu')` — no delete/recreate needed.

### Access check

Same as current: if no access, `answerCallbackQuery('Нет доступа')`, menu unchanged.

---

## Section 4: Permissions — Correct Menu Routing

### Bug

`routes.ts:386`: `actions.isAdmin(ctx.from?.id ?? 0)` compares user ID with `ADMIN_CHAT_ID`. In admin's private chat this works (chat ID == user ID). But if admin sends /menu in a group chat, `from.id` still matches `ADMIN_CHAT_ID` → admin menu shown in group chat.

### Fix

Replace `actions.isAdmin(ctx.from?.id ?? 0)` with `actions.isAdmin(ctx.chat?.id ?? 0)`.

This ensures:

- Private admin chat (`chat.id` == `ADMIN_CHAT_ID`): admin menu
- Any group chat (`chat.id` != `ADMIN_CHAT_ID`): user menu, even if admin is the sender

### Other `isAdmin` usages

Already correct in `MainService.ts` — they use `chatId` (from `ctx.chat?.id`), not `ctx.from?.id`.

---

## Files to modify

- `src/view/telegram/routes.ts` — all conversation functions, menu builders, command handler
- `src/view/telegram/MainService.ts` — `handleExportData` (progress flow), `handleResetMemory` (move confirmation to menu layer)
- `src/view/telegram/context.ts` — possibly extend SessionData if needed for tracking message IDs

## Out of scope

- Admin panel restructuring
- New features beyond the 4 sections above
- Migration away from grammY conversations
