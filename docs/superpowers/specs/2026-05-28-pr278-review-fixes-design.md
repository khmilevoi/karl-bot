# PR #278 Review Fixes — Design

**Date:** 2026-05-28
**Status:** Local-only (not committed)
**Scope:** Fix all 10 findings from the code review of PR #278 (telegraf → grammy migration).

---

## Summary

The grammy migration PR is solid overall, but the review surfaced 10 issues across four
themes: code bugs, menu-state correctness, repo hygiene, and missing test coverage. This
document defines the fix approach for each. The guiding principle for menu behavior is the
pattern already established in the codebase's conversation handlers: **after an action that
consumes a menu message, delete the stale message and send a fresh one with the menu
attached** — never leave the user on a message whose keyboard was stripped by
`editMessageText`.

---

## Group A — Code bugs

### A1. `adminTopicTime` reads stale ctx (routes.ts:239)

`conversation.external(() => ctx.session?.selectedChatId)` closes over the outer-scope `ctx`
captured at conversation entry, not the replayed conversation state. Every other handler uses
`(ctx) => ctx.session?.selectedChatId`.

**Fix:** Change to `conversation.external((ctx) => ctx.session?.selectedChatId)`.
A regression test enters the conversation and asserts the selected chat id is read from the
replayed context.

### A2. Unreachable `return null` (routes.ts:157)

The `while (retries < 2)` loop always returns inside the body on the final retry, so the
trailing `return null` is dead code.

**Fix:** Restructure as a bounded loop (e.g. `for (let attempt = 0; attempt < 2; attempt++)`)
with explicit returns on cancel / valid / exhausted, removing the unreachable statement.

### A3. Dead fields in `InputResult<T>` (routes.ts:80-84)

`userMessageId` and `promptMessageId` are deleted inside `waitForInputOrCancel` before it
returns; all six callers read only `.value`.

**Fix:** `waitForInputOrCancel` returns `T | null` (the validated value or null on
cancel/exhaustion). Remove the `InputResult` interface. Update all six conversation handlers
to use the returned value directly (`if (result === null) return; ... result` instead of
`result.value`).

### A10. `setImmediate` yield lacks rationale (MainService.ts:304)

**Fix:** Add a one-line comment explaining the yield prevents blocking the event loop between
bulk document sends.

---

## Group B — Menu state after actions

Root cause: `editMessageText` without `reply_markup` removes the inline keyboard, stranding the
user. The codebase already solves this in conversation handlers via fresh
`ctx.api.sendMessage(chatId, title, { reply_markup: menu })`.

**Decision:** Data operations stay in `MainService`; "return to menu" UI lives in `routes.ts`
where the `Menu` objects exist. Add a `sendMainMenu(ctx)` helper in `routes.ts` that selects the
admin or user menu via `actions.isAdmin(ctx.chat.id)` and sends a fresh message.

### B4 + B6. Memory reset leaves no menu / edits menu-owned message (routes.ts:480-487, MainService.ts:320-360)

**Fix:**
- `handleResetMemory` becomes a pure data operation: access check + `memories.reset(chatId)`,
  returning a boolean (or throwing). It no longer edits messages.
- The `confirm_reset` "✅ Да, сбросить" handler: `editMessageText('⏳ Сбрасываю память...')`,
  call `resetMemory`, then delete the message and `sendMainMenu` titled "✅ Память сброшена!"
  (on failure: fresh menu with an error title).
- The "❌ Отмена" `.back('...')` path is unchanged (native menu nav back to `user_menu`).

### B5. Export access-denied sends a duplicate keyboard (routes.ts:519-523)

**Fix:** Replace `ctx.reply(text, { reply_markup: requestDataAccessMenu })` with
`ctx.editMessageText(text, { reply_markup: requestDataAccessMenu })`, transforming the existing
user-menu message in place so only one live keyboard remains. Wrap in try/catch (message may be
gone) and fall back to `ctx.reply` on failure.

### B (export completion). Re-attach menu after export

For consistency with the reset flow, after `handleExportData` finishes the corresponding menu
handler sends a fresh main menu via `sendMainMenu`. `handleExportData` keeps its progress UI
and its informational replies for the no-data and error paths, but drops the redundant final
success reply ("✅ Загрузка данных завершена!") — the fresh menu sent by the route handler
becomes the terminal state. The progress message is deleted on all paths before returning.

---

## Group C — Repo hygiene

### C7. `.claude` settings committed

**Fix:** Re-add `.claude` to `.gitignore`; `git rm --cached .claude/settings.local.json`.

### C8. Planning/spec docs committed

**Fix:** Add `docs/superpowers/` to `.gitignore`; `git rm -r --cached docs/superpowers/plans
docs/superpowers/specs`. This fix work's own spec and plan are written under
`docs/superpowers/` and therefore stay local-only (per user decision).

---

## Group D — Tests (core flows)

To make routing testable, export the currently file-private surfaces needed by tests:
`waitForInputOrCancel` and (as needed) the menu/command wiring. Tests follow the existing
vitest + mock-`Context` pattern (`as unknown as Context`, mock bot capturing
`command`/`callbackQuery`/`use`/`on`).

Coverage to add:
1. **`waitForInputOrCancel`**: valid input returns parsed value; cancel callback returns null;
   invalid-then-valid retry; two invalid attempts returns null and sends the "too many
   attempts" message.
2. **Admin vs user routing**: `/start` (and `/menu`) replies with the admin menu when
   `isAdmin(chat.id)` is true, user menu otherwise.
3. **Export progress state machine** (`handleExportData`): no-data path, multi-file progress
   edits, error path — asserted via mock `ctx.api.editMessageText` / `replyWithDocument` call
   sequences.
4. **Reset confirmation flow**: access-denied returns early without `memories.reset`; granted
   path calls `memories.reset` and returns success.

---

## Out of scope

- No broader refactor of the trigger pipeline or application layers.
- No change to the grammy/plugin versions.
- No new menu features beyond the correctness fixes above.

---

## File map

| Action | File | Findings |
| ------ | ---- | -------- |
| Modify | `src/view/telegram/routes.ts` | A1, A2, A3, B4, B5, B6, D |
| Modify | `src/view/telegram/MainService.ts` | A10, B4, B-export |
| Modify | `.gitignore` | C7, C8 |
| Untrack | `.claude/settings.local.json` | C7 |
| Untrack | `docs/superpowers/plans/*`, `docs/superpowers/specs/*` | C8 |
| Modify/Add | `test/routes.test.ts` (or new) | D |
| Modify | `test/MainService.test.ts` | D |
