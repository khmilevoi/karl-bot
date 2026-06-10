# Behavior context comprehension + internal-ID leak fix (ordinal remap)

- **Date:** 2026-06-01
- **Status:** Approved design, ready for implementation plan
- **Scope:** All 4 root causes (full fix). ID strategy: ordinal remap (Approach 2).
- **Local-only:** this file lives under `docs/superpowers/` and MUST NOT be committed (per repo `CLAUDE.md`).

## Problem

In a live chat, Carl (the bot) stopped understanding which message a user was
referring to, and at one point emitted internal message-store IDs into a visible
reply, formatted as if they were article citations:

> «Про Даниила, он и писал это — **ст. 150 и 154–161**. Ты там вообще мимо кассы.»

### Evidence (found in `prompts.log`)

The exact exchange is the `behaviorDecision` call at `2026-06-01T11:38:01.274Z`
(`prompts.log` ~lines 10477–10528). The trigger was `[storeId:168]` "ты про кого
в это сообщении?", and the reply leaked `storeId` 150 and 154–161 — which are the
internal `messages.id` values of Даниил Попырев's (`sayboter`) messages in the
batch. The bot did not invent "статьи"; it copied internal `storeId` markers from
the prompt into user-visible text.

A secondary symptom: in a `behaviorGate` call (~line 10238) the model returned
`triggerMessageIds: [33538]` — a **Telegram** `message_id`, not the `storeId`
(161) — even though the gate prompt forbids it.

## Root causes

**A. Internal `storeId` leaks into visible text.**
`PromptBuilder.addBehaviorMessages` (line ~331) renders each message as
`[storeId:N] [telegramId:M] [userId:U] [username:..] [fullName:..] [role:..]`, and
the system prompts instruct the model to "use messages.id values". Nothing prevents
the model from echoing those numbers into `action.text`.

**B. The bot never persists its own replies → it is blind to its own turns.**
`DefaultBehaviorExecutor.executeReply` / `executeAskQuestion` call
`messenger.sendMessage(...)` but never store an `assistant` message.
`MessageFactory.fromAssistant()` exists but is **dead code** (never called).
So `getLastMessages` returns only `role:user` rows; when a user references something
Carl said ("ты про кого в это сообщении?"), Carl has no record of his own message and
must guess. This is the primary driver of "doesn't understand context".

**C. Reply/quote linkage is dropped in the behavior message format.**
`addBehaviorMessages` renders only id/user/role + content; it omits the
`replyText` / `replyUsername` / `quoteText` fields that the legacy `user_prompt.md`
included. In a fast multi-party chat the model cannot reconstruct who replies to whom.

**D. Two numeric ID namespaces inline → ID-space confusion.**
Both `storeId` and `telegramId` are rendered inline; the model sometimes uses the
wrong one (returned a Telegram id where a `storeId` was required). The model never
actually needs `telegramId` (the executor resolves Telegram ids server-side) and
never needs `storeId` for targeting (selectors are `scope/pick/index`); raw `storeId`
is needed only for `evidence.messageIds`, a structured field.

## Key facts established during exploration

- Reply/quote target selection uses `scope` + `pick` + `index` (`MessageSelector`),
  **not raw ids** — so remapping ids does not affect targeting.
- `evidence.messageIds` / `sourceMessageIds` are written **directly into the DB**
  (truths, social signals, political positions) as real `messages.id`. Any id the
  model emits as evidence MUST be translated back to a real `messages.id` *before*
  reaching `DefaultStatePatchApplicator`, or persisted anchors get corrupted.
- The id-carrying response fields are exactly three:
  - gate: `triggerMessageIds`, `contextMessageIds` (`behaviorGateDecisionSchema`)
  - decision: `statePatches[].evidence.messageIds` (all `LiveStatePatch` variants)
  - evolution: `evolutionPatches[].evidence.messageIds` (all `EvolutionPatch` variants)
  - `truthId` / `positionId` / `relatedTruthIds` / `contradictsTruthIds` / `userId`
    are NOT message ids and must NOT be remapped.
- `patchEvidenceSchema.messageIds` is `z.array(z.number().int())` (no `min`), so an
  evidence array emptied by dropping unresolved ordinals is still schema-valid.
- `ChatGPTService` is the single implementation of `BehaviorAiService`; it builds
  prompts (via `PromptDirector`) and parses responses for all three lanes — the
  single choke point for the remap.

## Design

### 1. (B) Persist bot replies as `role:assistant`

- Change `ChatMessenger.sendMessage` to return `Promise<number | null>` — the sent
  Telegram `message_id`. `TelegramMessenger.sendMessage` returns `result.message_id`
  from grammy's `api.sendMessage`.
- Inject `MessageService` into `DefaultBehaviorExecutor`. After a **successful**
  `reply` / `ask_question` send, persist an assistant message:
  `{ role:'assistant', chatId, content: action.text, messageId: <returned tg id>,
  userId: bot.id, username: bot.username, replyText/replyUsername: from the resolved
  reply target (optional) }`. Bot identity comes from `messenger.bot.botInfo`.
- Provide a ctx-less assistant builder (extend `MessageFactory` or build the
  `StoredMessage` inline in the executor).
- Do not persist on send failure.

### 2. (C) Restore reply/quote linkage in the behavior prompt

- `addBehaviorMessages` renders the existing `replyText` / `replyUsername` /
  `quoteText` fields as compact sub-lines, e.g.
  `↳ ответ @user: "…"` and `❝ цитата: "…"`, truncating long quoted text.

### 3. (A+D) Ordinal remap

- New value object `MessageReferenceMap` built from a lane's message list:
  assigns 1-based ordinals `#N` in ascending `storeId` order; exposes
  `ordinalFor(storeId)` and `storeIdFor(ordinal): number | null`.
- `addBehaviorMessages` renders each line as
  `[#N] [@username (FullName)] [role:…]` + reply/quote sub-lines + content.
  **`[storeId:…]` and `[telegramId:…]` are removed entirely.** The
  `[TRIGGER]/[GATE_CONTEXT]/[BATCH]` markers are still computed from the real
  `storeId` sets server-side and decorate the correct rendered line.
- `ChatGPTService` owns the map per call:
  1. build `MessageReferenceMap` from `messages` (gate) / `context.messages`
     (decision, evolution);
  2. pass `storeId→ordinal` into `PromptDirector` → `addBehaviorMessages` for rendering;
  3. after Zod parse, translate ordinal→storeId in the three id fields above;
  4. drop (and log) ordinals that do not resolve;
  5. return decisions carrying **real `storeId`** — pipeline and patch applicator
     are unchanged.
- System prompts updated: targeting stays `scope/pick/index`; evidence and gate
  ids are now `#N`; explicit instruction never to write `#N` or any bracketed tag
  into visible `text`.
- Defense-in-depth backstop: `DefaultBehaviorDecisionValidator` strips any leaked
  `#\d+` / `[…]` tokens from `reply` / `ask_question` `text`, so even a model slip
  never reaches the chat.

**Safety guarantee:** the model no longer sees any real `messages.id`; translation
to real ids happens at the single AI boundary before any persistence, so evidence
anchors in truths/positions/signals stay correct `messages.id` and the "ст. 150"
class of leak is structurally impossible.

## Affected files

- `src/application/interfaces/chat/ChatMessenger.ts` (return type)
- `src/view/telegram/TelegramMessenger.ts`
- `src/application/behavior/DefaultBehaviorExecutor.ts` (+ `MessageService` dep)
- `src/application/use-cases/messages/MessageFactory.ts` (ctx-less assistant builder)
- `src/application/prompts/PromptBuilder.ts` (`addBehaviorMessages`)
- `src/application/prompts/PromptDirector.ts` (thread the map)
- `src/infrastructure/external/ChatGPTService.ts` (build map + translate, 3 lanes)
- new: `MessageReferenceMap` value object (+ tests)
- prompt templates: `prompts/behavior_messages_prompt.md`,
  `prompts/behavior_gate_system_prompt.md`,
  `prompts/behavior_decision_system_prompt.md`,
  `prompts/state_evolution_system_prompt.md`
- `src/application/behavior/DefaultBehaviorDecisionValidator.ts` (leak-guard backstop)
- tests across the above

## Testing strategy

- `MessageReferenceMap`: unit (ordinal assignment, round-trip, out-of-range → null).
- `addBehaviorMessages`: snapshot — output contains `[#N]`, reply/quote, markers,
  and NO `storeId` / `telegramId`.
- Translation: extract pure `translateGate` / `translatePatches` helpers and test
  ordinal→storeId, dropping unresolved ordinals.
- `DefaultBehaviorExecutor`: assistant message persisted after a successful reply
  (with the returned Telegram id); not persisted on failure.
- Validator leak-guard: strips `#5` / `[storeId:…]` from text.
- Regression: replay the screenshot scenario (storeIds 120–168) and assert no raw
  ids in any reply text and that assistant turns are persisted.

## Risks / migrations

- **No DB migrations.** Bot-reply persistence only adds rows to the existing
  `messages` table.
- Evidence-corruption risk eliminated (translation precedes persistence at one point).
- Ordinals are per-call; gate and decision build independent maps → no cross-call
  leakage.
- Residual model slip (writing `#5` into text) covered by the validator backstop.

## Decisions locked

1. Scope: fix all four root causes A/B/C/D.
2. ID strategy: ordinal remap (model never sees real ids; translated at the AI boundary).
3. No schema/DB migration.
4. Spec is local-only and not committed (repo `CLAUDE.md` overrides the default
   "commit the design doc" step).
