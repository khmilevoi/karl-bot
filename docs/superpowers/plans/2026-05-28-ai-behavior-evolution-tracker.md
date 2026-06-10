# AI Behavior Evolution — Execution Tracker

> **Local-only working artifact.** Lives under `docs/superpowers/` (gitignored). Do not commit.

**Source spec:** [`docs/superpowers/specs/2026-05-28-ai-behavior-evolution-design.md`](../specs/2026-05-28-ai-behavior-evolution-design.md)
**Flow notes:** [`docs/superpowers/specs/2026-05-28-ai-behavior-evolution-flow.md`](../specs/2026-05-28-ai-behavior-evolution-flow.md)

## Current status (2026-05-31)

- Current branch: `feat/ai-behavior-evolution-phase-5`; `main` was checked out and fast-forwarded to `336d8c7` (`feat(behavior): Phase 4 — State Evolution + Political Coordinates (#284)`) before the Phase 5 branch was created.
- Plans 01-03 are implemented and already included in `origin/main` through PRs `#281`, `#282`, and `#283`.
- Plan 04 is implemented and included in `origin/main` through PR `#284`. It adds migration `016`, state-evolution schemas/repos/services/prompts, `proposeStateEvolution`, evolution patch application, trigger/worker/scheduler services, DI wiring, and political-coordinate support.
- Plan 05 has been implemented on `feat/ai-behavior-evolution-phase-5` after the user explicitly approved execution on 2026-05-31.
- Phase 5 implementation in the working tree:
  - `MainService` stores approved Telegram messages through `MessageService.addMessage`, passes stored message ids to `BehaviorPipeline`, no longer generates replies through `DefaultChatResponder`, and starts `StateEvolutionScheduler.start()` at launch.
  - `MessageService.clearMessages` is now backed by `messages.is_active = 0`; normal history/count queries ignore inactive rows while `findByIds` can still resolve inactive evidence ids.
  - Migration `017_cutover_legacy_cleanup` adds `messages.is_active` and removes `users.attitude` plus `chat_configs.interest_interval`, with rollback coverage.
  - `DefaultChatResponder`, `ChatResponder`, `DefaultInterestChecker`, `InterestChecker`, `InterestTrigger`, `ChatMemory`, `ChatMemoryManager`, `InterestMessageStore`, `DefaultHistorySummarizer`, their DI bindings, and legacy tests are removed.
  - Chat config/routes/admin menu no longer expose the retired interest interval setting.
  - `AIService`/`ChatGPTService` now keep only summarization and topic-of-day from the old interface; `ask`, `checkInterest`, `assessUsers`, and legacy prompt paths are removed.
  - Topic-of-day user context no longer includes `attitude`, and topic prompts use `neutralCore` instead of the retired fixed persona prompt.
  - `summarize_thread` is explicitly deferred by default with `summarize_thread worker deferred until dedicated plan`.
- Plan 05 review corrections now captured in the plan:
  - migration `017` must cover message soft-delete (`messages.is_active`) and `chat_configs.interest_interval`, not only `users.attitude`;
  - `MessageService.clearMessages` must become a soft-delete/exclusion operation so reset/summarization do not hard-delete evidence messages;
  - `ChatMemory` / `ChatMemoryManager` / `InterestMessageStore` and `HistorySummarizer.assessUsers` must be retired with the old interest/user-attitude path;
  - `summarize_thread` is explicitly deferred/disabled in Phase 5; a non-destructive queue consumer is a separate follow-up plan.
- Focused verification already run on Phase 5 WIP:
  - `test/MainService.test.ts` → PASS (`11` tests)
  - `test/TriggerPipeline.test.ts` → PASS (`6` tests)
  - `test/TriggerPipeline.test.ts test/MainService.test.ts test/container.behavior.test.ts` → PASS (`21` tests total)

## Decomposition decision

One spec → multiple plans, **one plan per phase**. This is a single coherent subsystem (the AI behavior rebuild), not a set of independent subsystems, so it stays as one approved spec. The spec's `Phasing` section already provides natural plan boundaries. Each plan produces working, testable software; because the phases are sequential, each plan declares the prior phase as a prerequisite.

Plans are written **one at a time, just before execution** — not all five up front — so that reality from earlier phases refines later plans and they don't go stale. Plans 01-04 are now executed; Plan 05 was written on 2026-05-31 when cutover work started.

A sixth plan (**Plan 06 — Political Coordinates**) was proposed on 2026-05-30 for the spec's `Political Coordinates` amendment, then folded into Plan 04 on 2026-05-31 by user decision. It is no longer a standalone plan.

## Resolved blocking decisions (from spec "Open Design Choices")

These were open in the spec; resolved against the actual codebase state so Phase 1 can proceed:

- **Zod version** → **Zod v4 (already installed: `^4.4.3`)**. The spec's "currently Zod v3" premise is stale. Use native `z.toJSONSchema()` for the OpenAI JSON Schema; no converter dependency, no upgrade. Zod is currently used in exactly one file (`src/infrastructure/config/envSchema.ts`), so adoption is trivial.
- **Structured output syntax** → **strict JSON Schema response format** (`response_format: { type: 'json_schema', strict: true }`), matching the spec's stated preference. OpenAI SDK is `^6.39.1`, which supports it (and the `openai/helpers/zod` helpers). Settled at the contract level in Phase 1; exact wiring exercised in Phase 2.

## Sequencing refinements (decided during planning)

- **Phase 1 migration is additive, not destructive.** Phase 1 only **adds** the six new behavior tables (non-breaking). The legacy answer flow keeps working until Phase 5. The spec's "greenfield destructive migration" and the removal of `users.attitude` are **deferred to the Phase 5 cutover plan**, because `users.attitude` is woven into the still-live legacy flow (`UserEntity`, `SQLiteUserRepository`, `SQLiteMessageRepository` JOIN, `assessUsers`). Removing it in Phase 1 would break a subsystem that isn't retired until Phase 5. The "greenfield" intent is honored at the data level (the dev DB holds nothing worth preserving).
- **Evidence message IDs resolve against `messages.id`** (the bot's own autoincrement PK), **not** the nullable Telegram `message_id`. This matches the spec line "All evidence message IDs resolve against the bot's own message store, not against Telegram."
- **Operational tables (`access_keys`, `chat_access`, `chat_users`, `chat_configs`) are preserved.** The spec named only `messages`/`users`/`chats`/`summaries` as operational, but access-control and menu/config subsystems are out of scope for this rebuild and must keep their tables.

## Plan status

- [x] **Plan 01 — Data and Contracts** (spec Phase 1)
  - File: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-01-data-and-contracts.md`
  - Scope: Zod schema foundation + `z.toJSONSchema()` wiring; behavior contract schemas (gate decision, behavior decision, actions, `LiveStatePatch`); evolution contract schemas (`EvolutionPatch`); state entities + schemas (personality, political, user profile, truth); event entities (behavior event, AI error event); additive migration for the 6 new tables; repositories (interfaces + SQLite impls + DI + tests); `BehaviorDecisionValidator`; `PatchPolicy`.
  - Depends on: —
  - Status: **implemented and included in `origin/main`** (merged via PR `#281`; current code includes the additive behavior tables, schemas, repositories, validator, and patch policy)

- [x] **Plan 02 — AI Decision Pipeline** (spec Phase 2)
  - File: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-02-decision-pipeline.md`
  - Scope: cheap behavior gate + per-chat batching (size cap / hard cap / idle gap); `decideBehavior` call with strict structured output; new prompt director flow + new prompt files; `behavior_events` logging; model routing/escalation + new task-oriented model slots replacing `ask`/`summary`/`interest`.
  - Depends on: Plan 01
  - Status: **implemented and included in `origin/main`** (merged via PR `#282` as `1a71c88`; live Telegram cutover still deferred by design)

- [x] **Plan 03 — Executor and Tools** (spec Phase 3)
  - File: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-03-executor-and-tools.md`
  - Scope: `BehaviorExecutor` for reply / react / ask_question / summarize_thread; empty-action-set handling; `BehaviorRateLimiter`; explicit reaction emoji set (`👍`, `👎`, `❤️`, `😂`, `😮`, `😢`, `😡`, `👏`, `🤔`, `🤝`, `💀`, `🤡`, `😭`, `🔥`, `👀`, `🙏`, `✨`, `🥹`, `🫶`, `🫠`); explicit `batchMessageIds` selector context; non-destructive `summarize_thread` enqueue/bump abstraction that does **not** call the current `DefaultHistorySummarizer.summarize(...)`; live-lane `StatePatchApplicator` for `UserProfilePatch | TruthPatch` only, including exact truth/profile status and confidence semantics.
  - Depends on: Plan 02 (can optionally merge 02+03)
  - Status: **implemented and included in `origin/main`** (merged via PR `#283` as `a41b0b3`; behavior executor remains additive until Plan 05)

- [x] **Plan 04 — State Evolution + Political Coordinates** (spec Phase 4 — absorbs the former Plan 06)
  - File: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-04-state-evolution.md`
  - Scope: background state-evolution pass (`stateEvolution` slot); personality + political + **user-political** patch proposal; descriptive-snapshot derivation; **bot + user political compass derivation**; per-chat high-water-mark trigger + cooldown + periodic sweep floor; single deduplicated worker per chat; risk-based prioritization; coordinate rendering into the live decision prompt.
  - Depends on: Plans 01–03
  - Status: **implemented and included in `origin/main`** (merged via PR `#284` as `336d8c7`). Implemented migration `016`; compass/user-political/personality-signal schemas and repos; state-evolution decision schema; user-political patch policy; `applyEvolutionPatches`; prompt rendering; `proposeStateEvolution` with radical-review escalation; context assembler; evolution event logging; pass orchestration; dedup worker; pipeline trigger; periodic scheduler; DI wiring; EnvService test updates; and risk-handling import cleanup. Scheduler `start()` + live Telegram cutover are being handled by Plan 05.

- [x] **Plan 05 — Cut Over** (spec Phase 5)
  - File: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-05-cutover.md`
  - Scope: route Telegram handling through the behavior pipeline; add message soft-delete and remove legacy AI fields (`users.attitude`, `chat_configs.interest_interval`); remove the legacy `DefaultChatResponder` / interest / memory / `assessUsers` paths; start `StateEvolutionScheduler`; explicitly defer `summarize_thread` worker execution.
  - Depends on: Plans 02–04
  - Status: **implemented on `feat/ai-behavior-evolution-phase-5`; PR pending**. Verification on 2026-05-31: `pnpm lint:fix`, `pnpm format:fix`, `pnpm test` (`293` tests), `pnpm type:check`, and `pnpm build` passed. Build emitted the known Rsbuild warning about loading `rsbuild.config.ts` as an ES module but exited successfully.

- [x] ~~**Plan 06 — Political Coordinates**~~ (spec `Political Coordinates` amendment, 2026-05-30)
  - **MERGED INTO AND IMPLEMENTED BY PLAN 04 (2026-05-31, user decision).** No longer a standalone plan. The data/contracts slice was not implemented in Phases 1–3, so all of it — `PoliticalCompass`/`PoliticalNote`/`UserPoliticalProfile` schemas, the `user_political_profiles` table + repo, the `compass_json` column on `bot_political_states`, `UserPoliticalPatch` in the evolution union, both compass derivations, and coordinate prompt rendering — shipped with Plan 04.

## Notes / risks carried forward

- `z.toJSONSchema()` strict-output compatibility is resolved by Plan 01's dedicated schema tests (every property required; nullable instead of optional fields).
- Reaction emoji whitelist (spec "Open Design Choices") is decided in Plan 03 as `👍`, `👎`, `❤️`, `😂`, `😮`, `😢`, `😡`, `👏`, `🤔`, `🤝`, `💀`, `🤡`, `😭`, `🔥`, `👀`, `🙏`, `✨`, `🥹`, `🫶`, `🫠`. The additions come from a 2026-05-30 internet check of Dictionary.com's Gen Z emoji guide and Emojipedia's laughter/popularity pages.
- Initial confidence thresholds for personality/political patches are resolved and implemented in Plan 04 by reusing `DEFAULT_PATCH_POLICY_CONFIG`.
- `gpt-5.5` escalation thresholds and Responses-API-vs-Chat-Completions for `decideBehavior` are resolved and implemented in Plan 02.
- Phase 2 keeps `MainService` and the legacy answer flow untouched. It builds `BehaviorPipeline` as an additive application service and leaves live Telegram cutover for Plan 05.
- Phase 2 exposes `messages.id` through message repositories/services for behavior evidence. It does **not** retire the legacy summarizer's `clearMessages(...)` behavior yet because the new pipeline is not connected to live traffic until Plan 05.
- **Plan 03 summarize_thread guard:** until the summarizer is refactored to append-only behavior, Phase 3 must not call `DefaultHistorySummarizer.summarize(...)` from the behavior executor. Plan 05 now explicitly defers/disables `summarize_thread`; the non-destructive worker belongs in a separate follow-up plan.
- **Plan 03 scope expansion:** live user/truth patch application is intentionally included because Phase 2 only logged `statePatches`. Personality, political, user-political, descriptive snapshot derivation, and background evolution are now implemented in Plan 04.
- Phase 2 keeps Chat Completions for `decideBehavior` and uses Phase 1's precomputed strict JSON Schema constants via `response_format: { type: 'json_schema', json_schema: ... }`; migration to Responses API remains out of v1 scope unless later implementation evidence changes that decision.
- Plan 04 implements political compasses as numeric axes/confidences, with write-time clamping to `[-10,10]` and `[0,1]`.
- `UserPoliticalPatch` lives in the **evolution lane** (`EvolutionPatch`), unlike the live-lane `UserProfilePatch`; user state spans both lanes by design and Plan 04 routes the user-political patches through policy/application.
- Plan 05 must explicitly start `StateEvolutionScheduler` in runtime bootstrap; Plan 04 only binds and tests the scheduler.
