# Spec Compliance & Code Audit — 2026-05-31

**Spec:** `docs/superpowers/specs/2026-05-28-ai-behavior-evolution-design.md`
**Scope:** Phases 1–4 (commits through `336d8c7`); migration 017 (Phase 5 cutover) present but live routing not yet switched.
**Auditor:** Claude (Sonnet 4.6), 4 parallel review sub-agents + manual verification of every high-severity claim.
**Method:** 4 finder agents (schemas/migrations, gate+pipeline, executor+patches, state-evolution+prompts). Every agent finding was re-checked against the real source because the agents produced several hallucinated line numbers and a few outright-wrong claims. Each finding below is tagged **CONFIRMED** / **REFUTED** / **MINOR**.

> Note on tooling: the RTK shell hook intermittently truncated/mangled `grep`/`Read`/`cat` output during this audit. All CONFIRMED findings were verified through at least one clean full-file read (PowerShell `Get-Content` or Bash). A few secondary `ChatGPTService.ts` routing details could not be re-verified through the noisy channel and are listed under "Unverified — needs follow-up."

---

## TODO List

- [x] Read spec + memory context
- [x] Map codebase structure
- [x] Audit: Zod schemas vs spec contracts (Phase 1)
- [x] Audit: Gate batching logic (Phase 2)
- [x] Audit: BehaviorPipeline / context assembly (Phase 2)
- [x] Audit: BehaviorDecisionValidator / PatchPolicy (Phase 2)
- [x] Audit: BehaviorExecutor — actions (Phase 3)
- [x] Audit: StatePatchApplicator — live + evolution patches (Phase 3/4)
- [x] Audit: StateEvolutionPass / trigger / scheduler / worker (Phase 4)
- [x] Audit: Political Coordinates — compass derivation (Phase 4)
- [x] Audit: Database migrations vs spec storage contract
- [x] Audit: Prompt files vs spec requirements
- [x] Compile findings
- [x] Dead-code sweep (D1–D4)
- [ ] Apply fixes (awaiting user decision on which severity tier to fix)

---

## CONFIRMED Findings (ranked by severity)

### 🔴 1. State-evolution cursor leapfrog silently skips live events that arrive during the AI call
**File:** `src/application/behavior/DefaultStateEvolutionPass.ts:197`
`cursor.lastEventId` is advanced to `Math.max(maxReadEventId, behaviorEventId)`. `maxReadEventId` is computed from events read *before* the AI call (line 117–125); `behaviorEventId` is the evolution event written *after* the call (line 188). Since the evolution event always gets the highest autoincrement id, the `max` always resolves to `behaviorEventId`. Any live `behavior_events` inserted **during** the (multi-second) AI call get ids strictly between `maxReadEventId` and `behaviorEventId` — and the next run reads only `id > behaviorEventId`, so those events are **never reconciled into personality/political state**.
**Impact:** Lost social-evolution signal on active chats; the busier the chat, the more events are dropped each pass.
**Fix direction:** advance the cursor to `maxReadEventId` only, and make the trigger ignore `modelSlot='stateEvolution'` rows (see #2) so the evolution event doesn't self-trigger. The pass already filters its own events via `liveNew` (line 121), so re-reading the evolution event is harmless.

### 🟠 2. Trigger & sweep count the pass's own events (self-trigger), currently masked only by the leapfrog bug
**Files:** `src/application/behavior/DefaultStateEvolutionTrigger.ts:48`, `src/infrastructure/persistence/sqlite/SQLiteStateEvolutionCursorRepository.ts:54`
`countByChatIdAfter` and `findChatsNeedingSweep` count **all** `behavior_events` after the cursor, with no `modelSlot != 'stateEvolution'` filter. The spec explicitly requires filtering own rows "to avoid self-trigger loop." Today this is hidden because bug #1's leapfrog pushes the cursor past the evolution event. **If #1 is fixed naively (cursor = maxReadEventId), the self-trigger loop becomes live.** These two must be fixed together: add a `countLiveByChatIdAfter` (or `WHERE model_slot != 'stateEvolution'`) and the same predicate in the sweep query.

### 🟠 3. Graceful shutdown does not stop the scheduler, HTTP server, or drain open gate batches
**Files:** `src/index.ts:24-31`, `src/view/telegram/MainService.ts:147-149`
On `SIGINT`/`SIGTERM`, `index.ts` calls `main.stop(signal)` and nothing else (no `process.exit`, no `server.close`). `MainService.stop()` only calls `this.messenger.stop(reason)`. It never calls `this.stateEvolutionScheduler.stop()` (the method exists, `DefaultStateEvolutionScheduler.stop()`), never closes the HTTP server, and never drains `BehaviorGateBatcher` timers. Result: after a stop signal the node-cron sweep keeps firing, the HTTP listener stays open, and in-memory batched (non-triggered) messages with pending `setTimeout` handles are abandoned.
**Impact:** Unclean shutdown; potential work after "stopped"; messages queued in a batch never get a gate decision (they are persisted in `messages`, but never evaluated).
**Fix direction:** add `BehaviorGateBatcher.shutdown()` (flush or clear timers) + `BehaviorPipeline.shutdown()`, call `stateEvolutionScheduler.stop()` and `server.close()` from `MainService.stop()`/`index.ts`.

### 🟠 4. Hard-boundary safety filter is effectively non-functional
**Files:** `src/application/behavior/DefaultPatchPolicy.ts:95-100`, `src/application/behavior/BehaviorConfig.ts:63-68`
`hitsHardBoundary` does case-insensitive `substring` matching against `hardBoundaryTerms`, which default to meta-descriptions: `'credible threat'`, `'real-world violence'`, `'dehumanization'`, `'targeted harassment'`. Real unsafe patch text (a stance, label, or truth) will essentially never contain these literal phrases, so the runtime safety floor the spec relies on at the patch layer is security theater — it'll pass genuinely unsafe content and only block text that happens to quote the category name. (Substring matching is also fragile in the other direction — a future single-word term like `'kill'` would match `'skill'`.)
**Fix direction:** this layer is a backstop; document that the model+prompt are the primary guard, and replace the phrase list with word-boundary regex matching against actual harmful tokens, or drop the pretense and rely on prompt-level enforcement + review escalation.

### 🟡 5. Evolution events are logged with empty message anchors and confidence 0
**File:** `src/application/behavior/DefaultBehaviorEventLogger.ts:78-88`; caller `DefaultStateEvolutionPass.ts:188-193`
`logEvolution` hardcodes `triggerMessageIdsJson: '[]'`, `contextMessageIdsJson: '[]'`, and `confidence: 0`. The spec says every `behavior_event` is anchored on `chatId + triggerMessageIdsJson + contextMessageIdsJson`. For evolution rows the anchor degenerates to `chatId` only. The pass *has* the processed `liveNew` events (with message ids) but doesn't forward them, and `logEvolution` even accepts a `contextMessageIds` param in one signature variant but the caller omits it. `confidence: 0` permanently conflates "no confidence field" with "zero confidence."
**Fix direction:** pass the processed event/message ids into `logEvolution` and populate `contextMessageIdsJson`; if `StateEvolutionDecision` has no confidence, store `null` not `0`.

### 🟡 6. `recomputeRuntimeFields` ignores labels (and positive patterns) when deriving trust/distance
**File:** `src/application/behavior/DefaultStatePatchApplicator.ts:871-902`
Spec: `trustLevel`/`preferredDistance` are "recomputed from affinity, **labels**, **patterns**, and grudges." The implementation uses only `affinityScore`, active grudges, and active *negative* patterns. Labels never influence the result, and positive patterns never raise trust. Defensible as a v1 heuristic, but it deviates from the stated derivation inputs.

### 🟡 7. Net-zero affinity patches are reported as `failed: patch was not processed`
**File:** `src/application/behavior/DefaultStatePatchApplicator.ts:182-217, 138-145`
When a decision contains opposing `user.adjust_affinity` patches for one user (e.g. `+1` and `-1`), `affinityDelta` sums to 0, `changed` stays `false`, the loop `continue`s, and those patches fall through to the catch-all that labels them `outcome: 'failed', reason: 'patch was not processed'`. They were actually validated and accepted; the correct outcome is `ignored` (net-zero) or `applied`. Misleading audit trail. Edge case, low blast radius.

### 🟡 8. Gate `reason` enum uses `attitude_to_bot`; spec says `attitude_to_carl`
**File:** `src/domain/behavior/schemas/gate.ts:15`
Internally consistent (nothing else references the spec spelling), so cosmetic — but it diverges from the documented contract and from `political_state`/persona naming ("Carl"). Trivial rename.

### 🟡 9. DB constraints weaker than the spec/Zod invariants
**File:** `migrations/015_create_behavior_tables.up.sql`
- `affinity_score INTEGER NOT NULL DEFAULT 0` (line 54) has no `CHECK (affinity_score BETWEEN -3 AND 3)`. Zod + applicator clamp it, so a bug elsewhere could persist out-of-range silently.
- `ai_error_events.chat_id` (line ~93) has no `FOREIGN KEY` to `chats(chat_id)`, unlike every other chat-scoped table (nullable for system errors is fine, but non-null values aren't validated).
Defense-in-depth only; not currently exploitable.

### 🟡 10. Prompt layout deviates from spec; legacy prompts still present
**Files:** `prompts/`
Spec says `user_profiles_prompt.md` should render social profiles **and** each user's compass + active political notes. Implementation splits political into a separate `user_political_profiles_prompt.md` (functionally equivalent, naming deviation). `political_state_prompt.md` dumps the whole JSON (compass is present in the blob but not labelled). Also, legacy prompts (`persona.md`, `assess_users_prompt.md`, `check_interest_prompt.md`, `reply_trigger_prompt.md`, `reply_decision_prompt.md`, …) still exist — expected, since Phase 5 cutover/`DefaultChatResponder` removal isn't done — but they should be removed during cutover so no fixed-ideology persona can leak.

---

## REFUTED (agent claims that the real source disproves)

- **"PoliticalCompass bounds never clamped at write"** — FALSE. `DefaultStateEvolutionPass.ts:61-76` defines `clampAxis`/`clampConfidence`/`clampCompass`, applied in `writeBotCompass:253` and `writeUserCompasses:315`.
- **"`writeUserCompasses` clobbers freshly-written notes with `notes:[]`"** — FALSE. It re-reads via `findByChatAndUser` (line 299) *after* `applyEvolutionPatches` has already upserted the notes, so existing notes are preserved; `notes:[]` only applies to genuinely new rows.
- **"Executor injects `rateLimiter` but never uses it / reactions unbounded"** — FALSE. `DefaultBehaviorExecutor.ts:51` calls `this.rateLimiter.checkAction` for every action; truth-add limiting is in `DefaultStatePatchApplicator.ts:103`.
- **"`drainForDirectTrigger` wrongly caps messages"** — FALSE per spec. Spec §Gate Batching: drained messages become contextMessageIds "trimmed to the size-cap budget, keeping the most recent" — exactly `entry.messages.slice(-maxDirectContextMessages)` (`BehaviorGateBatcher.ts:82`).
- **"jsonSchema omits `additionalProperties:false`"** — FALSE. `jsonSchema.ts:normalize` injects it on every object node and rewrites `oneOf`→`anyOf`.
- **"confidence unbounded because STRIP_KEYS removes min/max"** — FALSE. Stripping only affects the outbound OpenAI schema; `safeParse` still enforces `confidenceSchema.min(0).max(1)` at runtime.
- **"Weak personality signal should go to uncertainty, not reject"** — FALSE. `uncertaintyAreas` is a *political* concept; personality has no uncertainty bucket, so rejecting low-confidence personality signals (`DefaultPatchPolicy.ts:51`) is correct.
- **"Live validator must bound-check compass/affinity in statePatches"** — N/A. `LiveStatePatch` cannot carry a compass, and `user.adjust_affinity.delta` is a Zod literal `-1|1`, summed then clamped in the applicator. Compass only exists in the evolution decision and is clamped at write.
- **"`politics.adjust_position` radicalize isn't escalated"** — FALSE. `DefaultStatePatchApplicator.ts:538` blocks `newIntensity==='radical' && !reviewedByStrongModel` → `escalated`.
- **"Cursor not advanced on error causes infinite reprocessing"** — Mostly by design. On error (`DefaultStateEvolutionPass.ts:155`) the cursor holds and only `lastRunAt` advances (cooldown), so transient failures retry the same events rather than dropping them. Reasonable; a max-retry/dead-letter would be a future hardening, not a bug.

---

## ChatGPTService routing — resolved (read clean afterwards)

- ✅ **High-risk proactive routing IS implemented.** `decideBehavior` (`ChatGPTService.ts:131-134`) and `proposeStateEvolution` (`:219-222`) both start on the escalation model when `stateImpactRisk/maxStateImpactRisk === 'high'` (spec F5 satisfied). Reactive escalation also covers parse-fail, low-confidence, conflicting visible actions, and radical-patch review.
- 🟡 **`errorRepair` model slot is dead.** Defined in `EnvService`/config but never read by `ChatGPTService` (only `triggerGate`, `behaviorDecision`, `stateEvolution`, `summarization` are consumed). Reserved for an error-repair path that isn't built — harmless but misleading config.
- 🟡 **`generateTopicOfDay` borrows the `behaviorDecision` model** (`:365`) instead of a `summarization`/dedicated slot — minor coupling.
- ℹ️ **Escalated live calls keep `modelSlot='behaviorDecision'`** in `behavior_events` (`buildMetadata` `:203`); the escalation is recorded via the `escalated` flag + `escalationReason`, not a distinct slot name. (Only `logPrompt`'s local file label distinguishes `behaviorDecisionEscalated`.) By design, acceptable.
- ℹ️ Direct-trigger path hardcodes `stateImpactRisk: 'medium'` (`DefaultBehaviorPipeline.ts:163`); acceptable default, but direct triggers never get proactive strong-model routing even on socially charged turns.

---

## Decisions

1. **Run 4 parallel finder agents, then manually verify every high-sev claim.** Reason: the agents are fast at surfacing candidates but hallucinated several line numbers and made wrong claims (compass clamp, notes clobber, rate-limiter unused). Recall-first finders + a verification pass matches the code-review skill's design and prevents shipping false positives. Outcome: ~10 of ~30 raw candidates survived verification.
2. **Report findings without auto-fixing yet.** Reason: the audit spans correctness, spec-deviation, and hardening tiers; the user should choose how deep to go (e.g., fix the 🔴/🟠 logic bugs now, defer 🟡 hardening). Fixes #1+#2 are coupled and need a repo method change (`countLiveByChatIdAfter`), so they warrant explicit sign-off.
3. **Treat the RTK output corruption as a tooling issue, not code.** Reason: confirmed it's the shell hook post-processing `grep`/`Read`/`cat`; verified all CONFIRMED items through PowerShell `Get-Content` which was clean.

---

## Dead Code Sweep (added 2026-06-01)

Searched for orphaned code left after the behavior pipeline replaced the legacy answer flow. Method: traced every `PromptBuilder` method, prompt template, and `AIService` method to a live caller (excluding test files and self-definitions).

### 🟠 D1. Production-dead summarization chain (live caller removed, only tests reach it)
`ChatGPTService.summarize()` is invoked **only** from `test/ChatGPTService.test.ts` — no production code path calls it. `RepositorySummaryService` only does DB get/set/clear; it never generates a summary. The background summarizer that *should* own this is deferred (`DefaultBehaviorSummarizationQueue` is `enabled: false`, see D4). The whole chain hangs off the dead entry point:
- `AIService.summarize()` + `ChatGPTService.summarize()` (`ChatGPTService.ts:397`)
- `PromptDirector.createSummaryPrompt()` (`:24`) — only caller is `summarize()`
- builder steps reachable **only** through `createSummaryPrompt`: `addSummarizationSystem`, `addPreviousSummary`, `addMessages` → `addUserPrompt`
- templates reachable only through that chain: `summarization_system_prompt.md`, `previous_summary_prompt.md`, `user_prompt.md`
**Note:** this is *expected* mid-cutover state (Phase 5 + background summarizer not built), not a mistake — but it's currently unreachable code. Keep if the background summarizer will reuse it; otherwise it's removable. Flagging so it's a conscious choice, not silent rot.

### 🟡 D2. `PromptBuilder.addUserPromptSystem()` — fully dead
**File:** `src/application/prompts/PromptBuilder.ts:88`. Defined, but no `PromptDirector` flow calls it; only references are its own definition and a `vi.fn` mock in `test/PromptDirector.test.ts`. Its template `userPromptSystem` (`prompts/user_prompt_system_prompt.md`) is referenced **only** by this dead method. → method + template + the `userPromptSystem` field in `PromptFiles`/env maps are all removable.

### 🟡 D3. `PromptBuilder.addPriorityRulesSystem()` — fully dead
**File:** `src/application/prompts/PromptBuilder.ts:117`. Same shape as D2: no `PromptDirector` caller; references are the definition + `test/PromptBuilder.test.ts` + `test/PromptDirector.test.ts` mocks. Template `priorityRulesSystem` (`prompts/priority_rules_system_prompt.md`) is referenced only by this dead method. → method + template + env field removable. (Tests that exercise it are testing dead code.)

### 🟡 D4. `DefaultBehaviorSummarizationQueue` is inert (`enabled: false`) and `peek()` is unused
**File:** `src/application/behavior/DefaultBehaviorSummarizationQueue.ts`; config `BehaviorConfig.ts:101-104`. `enqueueOrBump` always returns `{ outcome: 'deferred' }`, so the `summarize_thread` action executes but no-ops by design ("worker deferred until dedicated plan"). `peek()` has no caller anywhere. Intentional placeholder, not a bug — listing for completeness so it's tracked until the summarizer plan lands.

### ✅ Verified NOT dead (legacy flow still wired during cutover)
- `DefaultTriggerPipeline`, `DefaultDialogueManager`, `MentionTrigger`/`NameTrigger`/`ReplyTrigger` — still live: `MainService.handleMessage` → `pipeline.shouldRespond` produces the `directTrigger` fed into `behaviorPipeline`. Not dead, despite being "legacy."
- `AIService.generateTopicOfDay` — live via `TopicOfDayScheduler`.
- `SummaryService` (get/set/clear) — live via context assemblers + topic-of-day + reset.

### Correction to earlier finding #10
The original report implied legacy prompts (`persona.md`, `check_interest_prompt.md`, `reply_trigger_prompt.md`, `assess_users_prompt.md`) still exist. **They do not** — the `prompts/` dir contains only current-system files. The real prompt-layer dead code is D1–D3 above (orphaned *new-era* builder methods/templates), not leftover legacy persona files.

### Suggested dead-code cleanup (independent of the bug fixes)
- Safe now: remove D2 + D3 (methods, templates, env `PromptFiles` fields, and their tests).
- Decision needed: D1 — keep as scaffolding for the background summarizer, or remove until that plan revives it. Don't half-remove (the queue D4 references the same future work).

---

## Suggested fix order (when approved)

1. #1 + #2 together — cursor advancement + `modelSlot` filter (one coherent change; highest correctness impact).
2. #3 — shutdown drains (`MainService.stop` → scheduler.stop + batcher.shutdown + server.close).
3. #5 — populate evolution-event anchors + `null` confidence.
4. #4 — safety-filter realism (decide: real token list vs. document-as-backstop).
5. #6–#10 — heuristic/reporting/schema/DB/prompt cleanups.
