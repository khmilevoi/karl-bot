# AI Behavior Evolution - Phase 3: Executor and Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute validated behavior decisions by sending replies, reactions, questions, requesting non-destructive summary work, applying live user/truth patches, and recording action/patch outcomes.

**Architecture:** Phase 3 stays additive: the behavior pipeline is still not connected to normal Telegram traffic. `DefaultBehaviorPipeline` validates the AI decision, executes surviving actions through a new `BehaviorExecutor`, requests `summarize_thread` through a non-destructive enqueue/bump service, applies live-only `UserProfilePatch | TruthPatch` values through a new `StatePatchApplicator`, then logs final action and patch results in `behavior_events`.

**Tech Stack:** TypeScript (CommonJS), Inversify, grammY Telegram API, existing repositories, Vitest, oxlint/oxfmt.

---

## Source

- Spec: `docs/superpowers/specs/2026-05-28-ai-behavior-evolution-design.md`
- Flow: `docs/superpowers/specs/2026-05-28-ai-behavior-evolution-flow.md`
- Tracker: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-tracker.md`
- Phase 2 carry-forward: live patch application was explicitly deferred from Phase 2, and the tracker has been updated so Phase 3 intentionally owns live `UserProfilePatch | TruthPatch` application.

## Scope Locks

- Do not route `MainService` through `BehaviorPipeline`; Phase 5 owns cutover.
- Do not create a git worktree; user explicitly requested a normal branch only.
- Do not implement personality or political evolution patches; Phase 4 owns those.
- `StatePatchApplicator` in this plan applies only live-lane `UserProfilePatch | TruthPatch`; `EvolutionPatch` stays out of scope.
- `summarize_thread` must not call `DefaultHistorySummarizer.summarize(...)` because that implementation clears messages and conflicts with append-only behavior. Phase 3 adds a separate enqueue/bump abstraction and records a `queued` / `bumped` / `deferred` action result; the real non-destructive background summarizer worker is deferred to Phase 5 or a dedicated summarizer refactor.
- Empty action sets are valid and must still allow valid live patches to apply.
- The allowed reaction emoji set is fixed in this plan and must be used by validator config, prompt guidance, and tests.

## Concrete Phase 3 Decisions

### Reaction Whitelist

`BehaviorDecisionValidatorConfig.allowedEmoji` is exactly the base set plus the researched youth/Gen Z additions:

```ts
[
  '👍',
  '👎',
  '❤️',
  '😂',
  '😮',
  '😢',
  '😡',
  '👏',
  '🤔',
  '🤝',
  '💀',
  '🤡',
  '😭',
  '🔥',
  '👀',
  '🙏',
  '✨',
  '🥹',
  '🫶',
  '🫠',
] as const
```

The validator drops any `react` action whose `emoji` is not an exact match. `BehaviorExecutor` never attempts to send a reaction that was dropped by validation.

Research basis checked on 2026-05-30:

- Dictionary.com Gen Z emoji guide: `💀` for laughter, `🤡` for foolish/cringe, `😭` for overwhelming funny/cute/sweet emotion, `🔥` for lit/hype, `👀` for interest/tell-me-more, `🙏` for thanks/hope.
- Emojipedia laughing emoji guide: `💀` and `😭` are prominent laughter/amusement emojis, especially in Gen Z/TikTok usage.
- Emojipedia most-popular page: `😭`, `✨`, `🔥`, `🥹`, `👀`, `🫶`, `🫠`, and `💀` are among current high-traffic emoji meaning pages, so they are safe additions to the base reaction vocabulary.

### Message Selector Sets

`BehaviorDecisionContext` and `BehaviorPromptContext` gain `batchMessageIds: number[]`.

- `scope: 'trigger'` resolves against `triggerMessageIds`, sorted by stored `messages.id` ascending.
- `scope: 'context'` resolves against `contextMessageIds`, sorted by stored `messages.id` ascending.
- `scope: 'batch'` resolves against `batchMessageIds`, sorted by stored `messages.id` ascending.
- For non-triggered gate batches, `batchMessageIds` is every stored message id from the flushed `BehaviorGateBatch.messages`, before the gate's trigger/context selection.
- For direct triggers, `batchMessageIds` is the drained pending batch ids only; the direct trigger itself remains in `triggerMessageIds`.
- `pick: 'first'` chooses the lowest sorted id, `pick: 'latest'` chooses the highest sorted id, `pick: 'index'` uses a zero-based index into that sorted set, and `pick: 'all'` resolves all ids in that set.
- Telegram targets use the stored message's Telegram `messageId`; if a selected stored message has no Telegram `messageId`, that target is dropped with a per-action result instead of crashing.

The recent ambient history window is prompt context only. It is not addressable through selectors unless the message id is also present in `triggerMessageIds`, `contextMessageIds`, or `batchMessageIds`.

### Summarize Thread

Create `BehaviorSummarizationQueue` with `enqueueOrBump({ chatId, intent, reason, triggerMessageIds, contextMessageIds, batchMessageIds })`. The Phase 3 default implementation is an in-memory per-chat dedupe queue:

- no pending request -> return `queued`;
- pending request for the same chat -> update intent/reason/ids and return `bumped`;
- worker unavailable or disabled -> return `deferred`.

It must not inject or call `HistorySummarizer`. This keeps Phase 3 executor behavior testable without invoking the current destructive `clearMessages(...)` path.

### Live Patch Semantics

Patch validation order: Zod schema -> `PatchPolicy.evaluate(...)` -> `BehaviorRateLimiter.checkPatch(...)` -> `StatePatchApplicator.applyPatches(...)`. Each patch records one `BehaviorPatchResult` with `patchType`, `outcome`, `reason`, and optional `stateRef`. Rejected patches never block unrelated patches.

User profile defaults for a missing `(chatId, userId)` row:

```ts
{
  userId,
  chatId,
  username: latestContextUsernameOrNull,
  affinityScore: 0,
  labels: [],
  patterns: [],
  grudges: [],
  trustLevel: 'none',
  preferredDistance: 'neutral',
  communicationStyle: '',
  conflictStyle: '',
  preferredTone: '',
  interests: [],
  updatedAt: nowIso,
}
```

Username fallback: use the latest rendered/context message for the patched `userId` that has `username`; otherwise preserve the existing profile username; otherwise store `null`. If a later context contains a username and the stored username is null or stale, update it with that latest username.

Profile patch rules:

- `user.adjust_affinity`: group accepted deltas per user, sum them once per decision, clamp final `affinityScore` to `[-3, 3]`, and record each grouped patch as applied with the same final profile ref.
- `user.add_label`: append `{ text: label, evidenceMessageIds: evidence.messageIds, status: 'active' }`.
- `user.add_pattern`: append `{ polarity, text, evidenceMessageIds: evidence.messageIds, status: 'active' }`.
- `user.add_grudge`: append `{ text, evidenceMessageIds: evidence.messageIds, status: 'active' }`.
- `user.contest_profile_signal`: match the latest non-`inactive` signal in the requested array by exact `text`; append the counter-evidence ids to that signal's `evidenceMessageIds`; transition `active -> contested`, `contested -> inactive`; reject with `target_not_found` when no non-inactive match exists. Signals are never deleted.

Runtime-derived profile fields are recomputed after all accepted patches for a user:

- `trustLevel`: `high` when `affinityScore >= 2` and no active grudges; `medium` when `affinityScore >= 1` and no active grudges; `low` when `affinityScore >= 0`; otherwise `none`.
- `preferredDistance`: `hostile` when active grudges >= 2 or `affinityScore <= -3`; else `avoidant` when active grudges = 1; else `mocking` when active negative patterns >= 2; else `cold` when `affinityScore <= -1`; else `warm` when `affinityScore >= 2`; otherwise `neutral`.

Truth patch rules:

- Confidence is always clamped to `[0, 1]`.
- New/revised truth status is `stable` when confidence >= `truthStableConfidence` and `fresh` otherwise. Default `truthStableConfidence` is `0.75`.
- `truth.add`: create a new truth with `text`, `sourceMessageIds = evidence.messageIds`, `confidence = evidence.confidence`, provided related/contradict ids after de-dupe, and status from confidence.
- `truth.reinforce`: require an existing non-`superseded` truth; merge evidence message ids; set `confidence = min(1, current + 0.2 * evidence.confidence)`; set status from confidence, allowing a contested truth to become `fresh` or `stable`.
- `truth.contest`: require an existing non-`superseded` truth; create a counter-truth from `counterText` with `contradictsTruthIds = [truthId]`; add the new counter-truth id to the target's `contradictsTruthIds`; merge counter evidence ids into the target `sourceMessageIds`; set target confidence to `max(0, current - 0.2 * evidence.confidence)` and target status to `contested`.
- `truth.revise`: require an existing non-`superseded` truth; create a replacement truth from `revisedText` with `relatedTruthIds` including the old truth id; copy old contradiction links; set replacement confidence to `max(old.confidence, evidence.confidence)`; mark the old truth `superseded` and link it to the replacement.

## File Structure

- Modify: `src/application/interfaces/chat/ChatMessenger.ts` - add Telegram reaction support.
- Modify: `src/view/telegram/TelegramMessenger.ts` - implement `setMessageReaction`.
- Create: `src/application/behavior/BehaviorRateLimiter.ts`
- Create: `src/application/behavior/DefaultBehaviorRateLimiter.ts`
- Create: `src/application/behavior/BehaviorSummarizationQueue.ts`
- Create: `src/application/behavior/DefaultBehaviorSummarizationQueue.ts`
- Create: `src/application/behavior/StatePatchApplicator.ts`
- Create: `src/application/behavior/DefaultStatePatchApplicator.ts`
- Create: `src/application/behavior/BehaviorExecutor.ts`
- Create: `src/application/behavior/DefaultBehaviorExecutor.ts`
- Modify: `src/application/behavior/BehaviorConfig.ts` - add executor/rate/validator config.
- Modify: `src/application/behavior/BehaviorDecisionValidator.ts` - add validator config service id.
- Modify: `src/application/behavior/DefaultBehaviorDecisionValidator.ts` - inject validator config id.
- Modify: `src/application/behavior/PatchPolicy.ts` - add policy config service id.
- Modify: `src/application/behavior/DefaultPatchPolicy.ts` - inject policy config id.
- Modify: `src/application/behavior/BehaviorContextAssembler.ts` - add `batchMessageIds` input.
- Modify: `src/application/behavior/DefaultBehaviorContextAssembler.ts` - fetch/render batch ids.
- Modify: `src/application/prompts/PromptTypes.ts` - add `batchMessageIds`.
- Modify: `src/application/prompts/PromptBuilder.ts` - mark `[BATCH]` messages.
- Modify: `prompts/behavior_decision_system_prompt.md` - include reaction whitelist and selector scope rules.
- Modify: `src/application/behavior/BehaviorTypes.ts` - add action and patch result DTOs.
- Modify: `src/application/behavior/BehaviorEventLogger.ts`
- Modify: `src/application/behavior/DefaultBehaviorEventLogger.ts` - accept final results.
- Modify: `src/application/behavior/DefaultBehaviorPipeline.ts` - validate, execute, apply, then log.
- Modify: `src/container/application.ts` - bind validator/policy config constants plus rate limiter, summarization queue, executor, applicator.
- Test: `test/BehaviorRateLimiter.test.ts`
- Test: `test/BehaviorSummarizationQueue.test.ts`
- Test: `test/StatePatchApplicator.test.ts`
- Test: `test/BehaviorExecutor.test.ts`
- Test: `test/BehaviorContextAssembler.test.ts`
- Test: `test/PromptBuilder.test.ts`
- Test: `test/BehaviorPipeline.test.ts`
- Test: `test/BehaviorEventLogger.test.ts`
- Test: `test/container.behavior.test.ts`

## Task 1: Result Types and Event Logging

- [ ] Write failing tests showing `DefaultBehaviorEventLogger` persists non-empty `actionResultsJson` and `patchResultsJson`.
- [ ] Add `BehaviorActionResult` and `BehaviorPatchResult` DTOs to `BehaviorTypes.ts`.
- [ ] Extend `BehaviorEventLogger.logDecision(...)` with optional `actionResults` and `patchResults`, defaulting to `[]`.
- [ ] Run `pnpm test test/BehaviorEventLogger.test.ts`.

## Task 2: Config and Selector Context

- [ ] Write failing tests showing validator/policy DI resolves from the container and `batchMessageIds` reaches prompt rendering.
- [ ] Add `BEHAVIOR_DECISION_VALIDATOR_CONFIG_ID`, `DEFAULT_BEHAVIOR_DECISION_VALIDATOR_CONFIG`, `PATCH_POLICY_CONFIG_ID`, and `DEFAULT_PATCH_POLICY_CONFIG`.
- [ ] Configure the reaction whitelist exactly as `['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '👏', '🤔', '🤝', '💀', '🤡', '😭', '🔥', '👀', '🙏', '✨', '🥹', '🫶', '🫠']`.
- [ ] Add `batchMessageIds` to context types, assembler input, pipeline calls, prompt markers, and tests.
- [ ] Render `[BATCH]` markers separately from `[TRIGGER]` and `[GATE_CONTEXT]`.
- [ ] Run `pnpm test test/BehaviorContextAssembler.test.ts test/PromptBuilder.test.ts test/container.behavior.test.ts`.

## Task 3: Rate Limiter

- [ ] Write failing tests for initiative, reaction, and truth-add windows.
- [ ] Add `BehaviorRateLimiter` with `checkAction(...)` and `checkPatch(...)`.
- [ ] Implement `DefaultBehaviorRateLimiter` as an in-memory per-chat sliding window.
- [ ] Add rate-limit config to `BehaviorConfig.ts`.
- [ ] Run `pnpm test test/BehaviorRateLimiter.test.ts`.

## Task 4: Summarization Queue

- [ ] Write failing tests for `queued`, `bumped`, and `deferred` summarize-thread requests.
- [ ] Add `BehaviorSummarizationQueue.enqueueOrBump(...)`.
- [ ] Implement `DefaultBehaviorSummarizationQueue` as an in-memory per-chat dedupe queue with no dependency on `HistorySummarizer`.
- [ ] Verify no Phase 3 test or production binding calls `DefaultHistorySummarizer.summarize(...)` from `BehaviorExecutor`.
- [ ] Run `pnpm test test/BehaviorSummarizationQueue.test.ts`.

## Task 5: Live State Patch Applicator

- [ ] Write failing tests for profile creation, username fallback, affinity summing/clamping, signal append, signal contest transitions, runtime-derived trust/distance, truth add/reinforce/contest/revise, policy rejection, and rate-limited truth adds.
- [ ] Add `StatePatchApplicator.applyPatches(...)`.
- [ ] Implement the exact live patch semantics from "Concrete Phase 3 Decisions".
- [ ] Apply live `UserProfilePatch` and `TruthPatch` independently; rejected patches must not block accepted patches.
- [ ] Run `pnpm test test/StatePatchApplicator.test.ts`.

## Task 6: Behavior Executor

- [ ] Write failing tests for reply, ask_question, react, selector resolution, summarize_thread, empty actions, invalid selector drops, Telegram failure logging, and rate-limited action drops.
- [ ] Add `BehaviorExecutor.execute(...)`.
- [ ] Implement selector resolution from `trigger`, `context`, and `batch` message sets using the exact `batchMessageIds` semantics above.
- [ ] Send `reply` / `ask_question` through `ChatMessenger.sendMessage`, `react` through `ChatMessenger.reactToMessage`, and `summarize_thread` through `BehaviorSummarizationQueue.enqueueOrBump(...)`.
- [ ] Run `pnpm test test/BehaviorExecutor.test.ts`.

## Task 7: Pipeline Integration and DI

- [ ] Write failing pipeline/container tests for validation, execution, patch application, and final event result logging.
- [ ] Inject `BehaviorDecisionValidator`, `BehaviorExecutor`, and `StatePatchApplicator` into `DefaultBehaviorPipeline`.
- [ ] Validate AI decisions before execution; invalid decisions log `ai_error_events` and do not send Telegram actions.
- [ ] Execute actions and apply patches before `BehaviorEventLogger.logDecision(...)`.
- [ ] Bind all Phase 3 services and config constants in `src/container/application.ts`; do not use `.to(DefaultBehaviorDecisionValidator)` or `.to(DefaultPatchPolicy)` unless their constructors have explicit `@inject(...)` config ids.
- [ ] Run `pnpm test test/BehaviorPipeline.test.ts test/container.behavior.test.ts`.

## Verification

- [ ] Run focused Phase 3 tests:

```bash
pnpm test test/BehaviorContextAssembler.test.ts test/PromptBuilder.test.ts test/BehaviorRateLimiter.test.ts test/BehaviorSummarizationQueue.test.ts test/StatePatchApplicator.test.ts test/BehaviorExecutor.test.ts test/BehaviorPipeline.test.ts test/BehaviorEventLogger.test.ts test/container.behavior.test.ts
```

- [ ] Run full project checks:

```bash
pnpm test
pnpm type:check
pnpm lint:fix
pnpm format:fix
pnpm build
```

## Completion Checklist

- [ ] Behavior decisions with empty actions are valid and still log an event.
- [ ] Reply, reaction, ask-question, and summarize-thread actions produce per-action results.
- [ ] Reactions use the exact Phase 3 emoji whitelist through `BehaviorDecisionValidator`.
- [ ] `scope: 'batch'` selectors resolve only through explicit `batchMessageIds`.
- [ ] `summarize_thread` never calls the current destructive `DefaultHistorySummarizer.summarize(...)`.
- [ ] Rate limits can drop visible actions and truth creation without crashing the decision.
- [ ] Live user/truth patches apply best-effort and record per-patch outcomes.
- [ ] Truth/profile patch confidence and status transitions match the "Concrete Phase 3 Decisions" rules.
- [ ] Validator and patch policy config are bound through explicit config ids or factories.
- [ ] Invalid AI decisions log an AI error and do not produce visible Telegram actions.
- [ ] `behavior_events.actionResultsJson` and `patchResultsJson` reflect final runtime outcomes.
- [ ] No `MainService` cutover happened.
