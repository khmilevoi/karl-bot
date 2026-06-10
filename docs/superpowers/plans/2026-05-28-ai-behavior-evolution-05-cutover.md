# AI Behavior Evolution Phase 5 Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagents are useful for review, but this environment only allows spawning when the user explicitly asks for sub-agent work.

**Goal:** Route live Telegram messages through the new behavior pipeline, start the state-evolution scheduler in runtime bootstrap, and retire the legacy free-form answer/user-attitude path.

**Architecture:** Keep message storage append-only by writing incoming Telegram messages through `MessageService.addMessage` directly in `MainService.handleMessage`; do not use `ChatMemory.addMessage` for live traffic because the legacy summarizer clears `messages`. Reuse direct mention/reply/name trigger logic only as a cheap direct-trigger detector, while all other traffic goes to `BehaviorPipeline` for batching/gating. Remove `users.attitude` and old AI methods once runtime no longer depends on them.

**Tech Stack:** TypeScript, grammY, Inversify, SQLite migrations, Vitest, RSBuild, pnpm.

---

## Review Status

Reviewed against the approved spec and the Phase 1-4 implementation on 2026-05-31. **Do not continue implementation until the user explicitly approves execution.** This revision fixes the original plan's main gaps:

- Phase 5 cleanup is broader than `users.attitude`: the old AI interest path also leaves `chat_configs.interest_interval`, menu controls, prompt paths, `InterestMessageStore`, and `checkInterest` dead surfaces.
- The spec's "no hard deletes" invariant applies to `messages`; simply bypassing `ChatMemory.addMessage` is not enough while reset/summarization still call `MessageService.clearMessages`.
- Removing `AIService.assessUsers` also requires retiring `HistorySummarizer.assessUsers` and the `ChatMemory` path that calls it.
- `summarize_thread` is currently queue-only. Phase 5 must explicitly defer/disable it as a documented follow-up and must not accidentally call the destructive legacy summarizer.
- User decision on 2026-05-31: keep the accidental Phase 5 WIP in the working tree. Do not revert it before execution; resume from it only after reconciling it with this corrected task order.
- User decision on 2026-05-31: defer `summarize_thread` worker implementation out of Phase 5. Phase 5 should explicitly return a deferred/disabled result for `summarize_thread` with tests, then handle the non-destructive worker in a separate plan.

## References

- Spec: `docs/superpowers/specs/2026-05-28-ai-behavior-evolution-design.md` — Phase 5, Storage, Live message pipeline, Gate batching.
- Flow: `docs/superpowers/specs/2026-05-28-ai-behavior-evolution-flow.md` — live pipeline + state-evolution scheduler.
- Tracker: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-tracker.md` — Plan 05 scope and Phase 4 carry-forward notes.
- Prior plan: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-04-state-evolution.md` — confirms `StateEvolutionScheduler.start()` and Telegram cutover were deferred.

## Files And Responsibilities

- `src/view/telegram/MainService.ts` — live Telegram cutover: store message, detect direct trigger, call `BehaviorPipeline`, start `StateEvolutionScheduler`.
- `test/MainService.test.ts` — behavior routing tests; update constructor mocks for new dependencies.
- `src/view/telegram/triggers/*` and `src/domain/triggers/Trigger.ts` — keep or narrow to direct triggers only; remove AI interest trigger from live registrations.
- `src/container/view.ts` — stop registering `InterestTrigger`; keep mention/reply/name triggers if `DefaultTriggerPipeline` remains the direct detector.
- `src/container/application.ts` — remove legacy `DefaultChatResponder`, `DefaultInterestChecker`, `InterestMessageStore`, `ChatMemoryManager`, and any bindings no longer used; keep summarization only through a non-destructive path.
- `src/application/interfaces/ai/AIService.ts` and `src/infrastructure/external/ChatGPTService.ts` — remove `ask`, `checkInterest`, `assessUsers`; keep `summarize` and `generateTopicOfDay`.
- `src/application/use-cases/chat/ChatMemory.ts`, `src/application/interfaces/chat/ChatMemory.ts`, `src/application/interfaces/chat/ChatMemoryManager.ts`, `src/application/use-cases/messages/InMemoryInterestMessageStore.ts`, `src/application/interfaces/messages/InterestMessageStore.ts` — delete once `MainService` reset uses `ChatResetService` directly and live storage uses `MessageService`.
- `src/application/use-cases/chat/DefaultHistorySummarizer.ts`, `src/application/interfaces/chat/HistorySummarizer.ts` — retire from the live behavior path; do not connect it to `summarize_thread` because the worker is deferred out of Phase 5.
- `src/application/use-cases/chat/DefaultChatResponder.ts`, `src/application/interfaces/chat/ChatResponder.ts`, `src/application/use-cases/interest/DefaultInterestChecker.ts`, `src/application/interfaces/interest/InterestChecker.ts`, `src/view/telegram/triggers/InterestTrigger.ts` — delete after bindings/tests are migrated.
- `src/domain/entities/UserEntity.ts`, `src/infrastructure/persistence/sqlite/SQLiteUserRepository.ts`, `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts`, `src/application/use-cases/scheduler/TopicOfDayScheduler.ts`, prompt types/templates — remove `attitude` reads and writes.
- `src/domain/entities/ChatConfigEntity.ts`, chat config service/repository, Telegram routes, and related tests — remove the old interest interval config/menu surface with the retired interest checker.
- `migrations/017_cutover_legacy_cleanup.up.sql`, `migrations/017_cutover_legacy_cleanup.down.sql`, `test/behaviorMigration017.test.ts` — add message soft-delete support and remove legacy AI fields (`users.attitude`, `chat_configs.interest_interval`) with rollback.
- `src/application/behavior/BehaviorConfig.ts`, `src/application/behavior/DefaultBehaviorSummarizationQueue.ts`, `src/application/behavior/DefaultBehaviorExecutor.ts`, `test/BehaviorExecutor.test.ts`, `test/BehaviorSummarizationQueue.test.ts` — explicitly disable/defer `summarize_thread` in Phase 5 instead of leaving a queue that suggests background work exists.
- Legacy tests (`test/ChatResponder.test.ts`, `test/InterestChecker.test.ts`, `test/InterestTrigger.test.ts`, old attitude assertions) — delete or rewrite to the new behavior contracts.

## Locked Decisions

- Live message storage must be append-only. Do not call `ChatMemory.addMessage` in `MainService.handleMessage` after cutover because it may run `DefaultHistorySummarizer.summarize(...)` and clear evidence messages.
- `MessageService.clearMessages` must become a soft-delete/exclusion operation for `messages`, not a physical `DELETE`, to satisfy the spec's evidence-retention invariant. `findByIds` should still resolve inactive rows so old evidence references remain valid; normal history windows/counts should ignore inactive rows.
- Direct triggers are mention, reply-to-bot, and name prefix. The old `InterestTrigger` / `checkInterest` AI path is retired; non-direct messages are handled by behavior gate batching.
- The old chat `interestInterval` setting has no behavior-pipeline meaning and must be removed from config storage, routes, admin/user menus, and tests instead of being left as a dead knob.
- `BehaviorPipeline` owns visible Telegram actions. `MainService` must not call `DefaultChatResponder`, `ctx.reply(answer)`, or `withTyping(...)` around answer generation.
- `StateEvolutionScheduler.start()` starts from `MainService.launch()` alongside the topic scheduler and messenger.
- `MainService` reset should depend on `ChatResetService` directly after cutover; it should not keep `ChatMemoryManager` alive only for reset.
- `summarize_thread` is deferred for Phase 5. The default runtime behavior should return a clear `deferred` action result such as `summarize_thread worker deferred until dedicated plan`; do not implement a queue consumer in this phase.
- `docs/superpowers/**` stays local-only and must not be committed.

## Task 1: Add Message Soft Delete And Legacy Field Migration

**Files:**
- Create: `migrations/017_cutover_legacy_cleanup.up.sql`
- Create: `migrations/017_cutover_legacy_cleanup.down.sql`
- Create/modify: `test/behaviorMigration017.test.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts`
- Modify: `src/application/interfaces/messages/MessageService.ts`
- Modify: `src/domain/repositories/MessageRepository.ts`
- Modify message repository/service tests.

- [ ] **Step 1: Write migration + repository failing tests**

Cover all three schema changes in `test/behaviorMigration017.test.ts`:

- `messages` gains `is_active INTEGER NOT NULL DEFAULT 1`;
- `users.attitude` is removed;
- `chat_configs.interest_interval` is removed;
- down migration restores `users.attitude`, `chat_configs.interest_interval`, and removes `messages.is_active`.

Add repository tests that insert messages, call `clearByChatId`, and assert:

- rows remain in `messages` with `is_active = 0`;
- `findByChatId`, `findLastByChatId`, and `countByChatId` ignore inactive rows;
- `findByIds` can still load inactive rows by stored id for evidence/reference repair.

- [ ] **Step 2: Verify RED**

Run: `pnpm test test/behaviorMigration017.test.ts test/RepositoryMessageService.test.ts test/sqliteRepositories.test.ts`

Expected: FAIL because migration `017` and soft-delete behavior do not exist.

- [ ] **Step 3: Implement migration**

Use SQLite column operations:

```sql
ALTER TABLE messages ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users DROP COLUMN attitude;
ALTER TABLE chat_configs DROP COLUMN interest_interval;
```

Down migration:

```sql
ALTER TABLE chat_configs ADD COLUMN interest_interval INTEGER NOT NULL DEFAULT 25;
ALTER TABLE users ADD COLUMN attitude TEXT;
ALTER TABLE messages DROP COLUMN is_active;
```

- [ ] **Step 4: Implement repository behavior**

Change `SQLiteMessageRepository.clearByChatId` to `UPDATE messages SET is_active = 0 WHERE chat_id = ?`. Filter active rows in normal history/count methods. Do not filter `findByIds`.

- [ ] **Step 5: Verify GREEN**

Run the same focused tests. Expected: PASS.

## Task 2: Route `MainService` Through `BehaviorPipeline`

**Files:**
- Modify: `test/MainService.test.ts`
- Modify: `src/view/telegram/MainService.ts`

- [ ] **Step 1: Write failing direct-trigger test**

Add or rewrite a `MainService.handleMessage` test that:

```ts
it('stores approved messages and sends direct triggers to BehaviorPipeline', async () => {
  const deps = makeDeps();
  const addMessage = vi.fn().mockResolvedValue(42);
  deps.messages = { addMessage } as unknown as MessageService;
  deps.pipeline.shouldRespond = vi.fn().mockResolvedValue({
    replyToMessageId: 77,
    reason: { message: 'mentioned', why: 'bot mention' },
  });
  deps.behaviorPipeline.handleStoredMessage = vi
    .fn()
    .mockResolvedValue({ kind: 'decided', behaviorEventId: 9 });

  const service = buildService(deps);
  const ctx = makeTextCtx({ chatId: 2, messageId: 77, text: '@Carl hi' });

  await (service as any).handleMessage(ctx);

  expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({
    chatId: 2,
    content: '@Carl hi',
  }));
  expect(deps.behaviorPipeline.handleStoredMessage).toHaveBeenCalledWith({
    message: expect.objectContaining({ id: 42, chatId: 2, messageId: 77 }),
    directTrigger: {
      reason: 'direct_trigger',
      why: 'bot mention',
      triggerMessageId: 42,
      replyToTelegramMessageId: 77,
    },
  });
  expect(ctx.reply).not.toHaveBeenCalled();
});
```

Use local helper names that match the current test file; keep mocks typed without `any`.

- [ ] **Step 2: Verify RED**

Run: `pnpm test test/MainService.test.ts`

Expected: FAIL because `MainService` still calls `ChatMemory.addMessage`, `TriggerPipeline.shouldRespond`, `ChatResponder.generate`, and `ctx.reply`.

- [ ] **Step 3: Implement minimal cutover**

In `MainService`:

- replace `CHAT_MEMORY_MANAGER_ID` / `ChatMemoryManager` with `CHAT_RESET_SERVICE_ID` / `ChatResetService` for reset handling;
- inject `MESSAGE_SERVICE_ID` / `MessageService`;
- inject `BEHAVIOR_PIPELINE_ID` / `BehaviorPipeline`;
- keep the existing trigger pipeline only as a direct-trigger detector for now;
- replace live `memory.addMessage(userMsg)` with `const storedId = await this.messages.addMessage(userMsg)`;
- build `StoredBehaviorMessage` as `{ ...userMsg, id: storedId, chatId }`;
- call `this.pipeline.shouldRespond(ctx, context)` only to produce direct-trigger metadata;
- call `this.behaviorPipeline.handleStoredMessage({ message, directTrigger })`;
- remove answer generation and `ctx.reply(answer)` from the live path.

Direct-trigger mapping:

```ts
const directTrigger = triggerResult
  ? {
      reason: 'direct_trigger' as const,
      why: triggerResult.reason?.why ?? triggerResult.reason?.message ?? 'direct trigger matched',
      triggerMessageId: storedId,
      replyToTelegramMessageId:
        triggerResult.replyToMessageId ?? userMsg.messageId ?? null,
    }
  : null;
```

- [ ] **Step 4: Add non-direct batching test**

Assert an approved non-trigger message calls `BehaviorPipeline.handleStoredMessage({ message, directTrigger: null })`, does not call `ctx.reply`, and does not call `ChatResponder.generate`.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm test test/MainService.test.ts`

Expected: PASS.

## Task 3: Start State Evolution Scheduler In Runtime Bootstrap

**Files:**
- Modify: `test/MainService.test.ts`
- Modify: `src/view/telegram/MainService.ts`

- [ ] **Step 1: Write failing launch test**

Update the launch test to provide two scheduler mocks:

```ts
expect(topicScheduler.start).toHaveBeenCalled();
expect(stateEvolutionScheduler.start).toHaveBeenCalled();
expect(messenger.launch).toHaveBeenCalled();
```

The state scheduler returns `void`, not `Promise<void>`.

- [ ] **Step 2: Verify RED**

Run: `pnpm test test/MainService.test.ts`

Expected: FAIL because `STATE_EVOLUTION_SCHEDULER_ID` is not injected into `MainService`.

- [ ] **Step 3: Implement scheduler wiring**

In `MainService` constructor inject:

```ts
@inject(new LazyServiceIdentifier(() => STATE_EVOLUTION_SCHEDULER_ID))
stateEvolutionScheduler: StateEvolutionScheduler
```

Store it as `private readonly stateEvolutionScheduler`.

In `launch()`:

```ts
this.stateEvolutionScheduler.start();
await Promise.all([
  this.messenger.launch().catch((error) => this.logger.error(error)),
  this.scheduler.start().catch((error) => this.logger.error(error)),
]);
```

If `start()` can throw synchronously, catch and log it.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test test/MainService.test.ts`

Expected: PASS.

## Task 4: Retire Legacy Chat Responder, Interest, Memory, And User-Assessment Paths

**Files:**
- Modify: `src/container/application.ts`
- Modify: `src/container/view.ts`
- Modify: `src/view/telegram/routes.ts`
- Modify: `src/application/interfaces/chat/ChatConfigService.ts`
- Modify: `src/application/use-cases/chat/RepositoryChatConfigService.ts`
- Modify: `src/domain/entities/ChatConfigEntity.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteChatConfigRepository.ts`
- Delete: `src/application/use-cases/chat/DefaultChatResponder.ts`
- Delete: `src/application/interfaces/chat/ChatResponder.ts`
- Delete: `src/application/use-cases/interest/DefaultInterestChecker.ts`
- Delete: `src/application/interfaces/interest/InterestChecker.ts`
- Delete: `src/view/telegram/triggers/InterestTrigger.ts`
- Delete: `src/application/use-cases/chat/ChatMemory.ts`
- Delete: `src/application/interfaces/chat/ChatMemory.ts`
- Delete: `src/application/interfaces/chat/ChatMemoryManager.ts`
- Delete: `src/application/use-cases/messages/InMemoryInterestMessageStore.ts`
- Delete: `src/application/interfaces/messages/InterestMessageStore.ts`
- Delete or rewrite: `test/ChatResponder.test.ts`, `test/InterestChecker.test.ts`, `test/InterestTrigger.test.ts`
- Delete or rewrite: `test/ChatMemory.test.ts`
- Modify: `test/TriggerPipeline.test.ts`, route/chat-config tests.

- [ ] **Step 1: Write failing container/test expectation**

Update `test/TriggerPipeline.test.ts` to cover direct triggers only: mention, reply, name, no AI interest check. Remove `InterestTrigger` from test construction.

Run: `pnpm test test/TriggerPipeline.test.ts test/MainService.test.ts`

Expected: FAIL while container/tests still expect interest-related code.

- [ ] **Step 2: Remove bindings/imports**

In `src/container/view.ts`, remove `InterestTrigger` registration. In `src/container/application.ts`, remove `CHAT_RESPONDER_ID`, `DefaultChatResponder`, `INTEREST_CHECKER_ID`, `DefaultInterestChecker`, `CHAT_MEMORY_MANAGER_ID`, `ChatMemoryManager`, `INTEREST_MESSAGE_STORE_ID`, and `InMemoryInterestMessageStore` imports/bindings. Remove `HistorySummarizer.assessUsers`; keep summarization only if the summarization follow-up task needs it.

- [ ] **Step 3: Remove interest interval UI/config**

Remove `interestInterval` from `ChatConfigEntity`, `ChatConfigService`, `RepositoryChatConfigService`, `SQLiteChatConfigRepository`, `MainService.getChatData`, `Actions`, and `routes.ts` menus/conversations. Update tests accordingly.

- [ ] **Step 4: Delete legacy tests and files**

Delete the responder and interest checker/trigger test files listed above after all call sites are gone.

- [ ] **Step 5: Verify**

Run: `pnpm test test/TriggerPipeline.test.ts test/MainService.test.ts test/container.behavior.test.ts test/routes.test.ts test/RepositoryChatConfigService.test.ts`

Expected: PASS.

## Task 5: Drop `users.attitude` From Code And Topic Prompts

**Files:**
- Modify: `src/domain/entities/UserEntity.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteUserRepository.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts`
- Modify: `src/domain/messages/ChatMessage.ts`
- Modify: `src/application/use-cases/scheduler/TopicOfDayScheduler.ts`
- Modify: `src/application/prompts/PromptTypes.ts`
- Modify: `prompts/chat_user_prompt.md`
- Modify related user/admin/topic tests with attitude assertions.

- [ ] **Step 1: Remove attitude from entities/repositories**

Change `UserEntity` to only hold `id`, `username`, `firstName`, `lastName`. Remove `setAttitude`. Change `SQLiteUserRepository` insert/select SQL to only use `id`, `username`, `first_name`, `last_name`. Change `SQLiteMessageRepository.SELECT_MESSAGE_COLUMNS` and `rowToMessage` to stop selecting/assigning `u.attitude`. Remove `attitude` from `ChatMessage`.

- [ ] **Step 2: Remove prompt attitude surface**

Change `PromptChatUser` and `prompts/chat_user_prompt.md` so topic-of-day user context no longer contains `attitude`. In `TopicOfDayScheduler`, map only username/fullName.

- [ ] **Step 3: Update tests**

Update `AdminServiceImpl`, `ChatGPTService`, `PromptBuilder`, `PromptDirector`, `RepositoryChatUserService`, `sqliteRepositories`, and topic scheduler tests to remove attitude expectations.

- [ ] **Step 4: Verify**

Run: `pnpm test test/sqliteRepositories.test.ts test/RepositoryChatUserService.test.ts test/TopicOfDayScheduler.test.ts test/PromptBuilder.test.ts test/PromptDirector.test.ts`

Expected: PASS.

## Task 6: Remove Dead AI Methods And Prompt Paths

**Files:**
- Modify: `src/application/interfaces/ai/AIService.ts`
- Modify: `src/infrastructure/external/ChatGPTService.ts`
- Modify: `src/application/prompts/PromptDirector.ts`
- Modify: `src/application/prompts/PromptBuilder.ts`
- Modify: `src/application/interfaces/env/EnvService.ts`
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`
- Delete: `prompts/assess_users_prompt.md`
- Delete: `prompts/check_interest_prompt.md`
- Delete: `prompts/reply_trigger_prompt.md`
- Delete: `prompts/persona.md` only after `topicOfDay` no longer uses the fixed persona; otherwise first switch topic-of-day to `neutralCore`.
- Modify: `test/ChatGPTService.test.ts`, `test/EnvService.test.ts`, `test/PromptTemplateService.test.ts`, prompt tests.

- [ ] **Step 1: Update AI interface tests**

Remove `ask`, `checkInterest`, `assessUsers` from test mocks. Keep `summarize` and `generateTopicOfDay`. Run a focused test set.

- [ ] **Step 2: Verify RED**

Run: `pnpm type:check`

Expected: FAIL at all remaining legacy method call sites.

- [ ] **Step 3: Remove interface and implementation methods**

Delete `ask`, `checkInterest`, and `assessUsers` from `AIService` and `ChatGPTService`. Remove `PromptBuilder.addCheckInterest`, `PromptBuilder.addAssessUsers`, `PromptBuilder.addReplyTrigger`, `PromptDirector.createAnswerPrompt`, `PromptDirector.createInterestPrompt`, `PromptDirector.createAssessUsersPrompt`, `extractChatUsers`, and `mapPrevAttitudes`. Keep `addAskSummary`, `addSummarizationSystem`, and topic-of-day prompt helpers because behavior/state-evolution/summarization still use summary context.

- [ ] **Step 4: Remove env prompt entries**

Remove `checkInterest`, `assessUsers`, `replyTrigger`, and eventually `persona` from `Env.prompts` and env services once no prompt builder method uses them. Remove tests that assert the old prompt paths exist.

- [ ] **Step 5: Verify**

Run: `pnpm type:check`

Expected: PASS.

## Task 7: Defer `summarize_thread` Worker Explicitly

**Files:**
- Modify: `src/application/behavior/BehaviorConfig.ts`
- Modify: `src/application/behavior/BehaviorSummarizationQueue.ts`
- Modify: `src/application/behavior/DefaultBehaviorSummarizationQueue.ts`
- Modify: `src/application/behavior/DefaultBehaviorExecutor.ts`
- Modify: `test/BehaviorExecutor.test.ts`
- Modify: `test/BehaviorSummarizationQueue.test.ts`

- [ ] **Step 1: Write failing executor test for deferred summarize action**

Update `test/BehaviorExecutor.test.ts` so `summarize_thread` produces a `deferred` action result with a clear reason and does not pretend work was queued for a running worker:

```ts
expect(results).toEqual([
  {
    actionType: 'summarize_thread',
    outcome: 'deferred',
    reason: 'summarize_thread worker deferred until dedicated plan',
  },
]);
```

- [ ] **Step 2: Write failing queue/config test**

In `test/BehaviorSummarizationQueue.test.ts`, assert that the default Phase 5 queue config disables queueing and returns the same deferred reason. Keep an explicit opt-in test for `{ enabled: true }` only if the queue unit tests still need to exercise `queued` and `bumped`.

- [ ] **Step 3: Implement explicit deferral**

Set `DEFAULT_BEHAVIOR_SUMMARIZATION_QUEUE_CONFIG.enabled` to `false` for Phase 5, and standardize the disabled reason returned by `DefaultBehaviorSummarizationQueue`. Do not add a summarization worker/service in this phase.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm test test/BehaviorExecutor.test.ts test/BehaviorSummarizationQueue.test.ts
pnpm type:check
```

Expected: PASS.

## Task 8: Full Regression And Cleanup

**Files:**
- Modify any remaining files surfaced by typecheck/lint.
- Update: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-tracker.md` status if desired, but do not commit docs/superpowers.

- [ ] **Step 1: Search for legacy leftovers**

Run:

```bash
rg -n "DefaultChatResponder|CHAT_RESPONDER|InterestChecker|InterestTrigger|InterestMessageStore|ChatMemoryManager|assessUsers|checkInterest|users\\.attitude|attitude|interestInterval|interest_interval" src test prompts migrations
```

Expected: only historical migrations/tests may mention `attitude` or `interest_interval`; no runtime `src` references to retired surfaces.

- [ ] **Step 2: Auto-fix lint/format**

Run:

```bash
pnpm lint:fix
pnpm format:fix
```

- [ ] **Step 3: Full verification**

Run:

```bash
pnpm test
pnpm type:check
pnpm build
```

Expected: all PASS.

- [ ] **Step 4: Final git review**

Run:

```bash
git status --short
git diff --stat
```

Confirm no `docs/superpowers/**` files are staged or committed.

## Risks And Watchpoints

- `DefaultTriggerPipeline` still starts/extends dialogue on direct triggers. This is acceptable for Phase 5 if only direct triggers are registered; if it becomes awkward, extract a dedicated `DirectBehaviorTriggerDetector` in a follow-up.
- The old summarizer and reset path can violate no-hard-delete unless `clearMessages` is made soft-delete first.
- `summarize_thread` is intentionally deferred in Phase 5. Treat a future non-destructive queue consumer as a separate plan, not as hidden Phase 5 scope.
- `TopicOfDayScheduler` remains a separate feature. It should not depend on `users.attitude`; if richer context is needed later, feed it user social profiles instead of restoring attitude text.
- `ChatGPTService` still implements both `AIService` and `BehaviorAiService`; after dead method removal, `AIService` should be only summarization/topic-of-day.
