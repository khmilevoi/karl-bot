# AI Behavior Audit Fixes Design

## Status

Drafted on 2026-06-01 from two behavior-system audits. This is a **specification**, not an implementation plan. Future sessions should create separate implementation plans from this spec, likely one plan per slice in "Planning Slices".

The previous implementation-style checklist in `docs/superpowers/plans/2026-06-01-ai-behavior-audit-fixes.md` has been superseded by this spec.

## Sources

- Audit 1: `docs/superpowers/audit/2026-05-31-spec-compliance-audit.md`
- Audit 2: `docs/superpowers/audit/codex-ai-behavior-evolution-review.md`
- Original behavior spec: `docs/superpowers/specs/2026-05-28-ai-behavior-evolution-design.md`
- Current tracker: `docs/superpowers/plans/2026-05-28-ai-behavior-evolution-tracker.md`

## Goal

Fix the behavior-system audit findings that can cause privacy leaks, cross-chat state contamination, dropped state-evolution input, inconsistent derived state, unclean shutdown, weak observability, and append-and-flag violations.

The result should preserve the current architecture:

- Telegram messages are stored first.
- AI output is structured and advisory.
- Runtime code validates what can be executed or persisted.
- Behavior/state changes are evidence-backed and reversible.
- Database rows are not physically deleted when they may be referenced by later evidence, state, or audit logs.

## Non-Goals

- Do not start code implementation from this spec directly; write dedicated implementation plans first.
- Do not redesign the full AI behavior architecture.
- Do not add a local keyword/regex/string-match safety filter to replace `hitsHardBoundary`.
- Do not attempt a broad content moderation subsystem in this fix set.
- Do not migrate from Chat Completions to Responses API as part of these audit fixes.
- Do not build the deferred background summarizer worker unless a later plan explicitly scopes it.
- Do not remove all dead code indiscriminately; only remove code confirmed production-dead or update docs that point to removed artifacts.

## Accepted Direction

### 1. Plans Become Specs First

The audit cleanup is too large for one monolithic implementation plan. This spec defines the target behavior and constraints. Separate sessions should create implementation plans from slices of this spec.

Recommended planning unit: one coherent risk area per plan, not one audit finding per plan.

### 2. Local Hard-Boundary String Matching Is Removed From Scope

The current `DefaultPatchPolicy.hitsHardBoundary()` uses substring checks against category descriptions like `"credible threat"` and `"real-world violence"`. This is not useful:

- real unsafe text usually will not literally contain those category names;
- future shorter terms would create false positives through substring matching;
- the model/provider already has its own safety layers;
- a hand-rolled keyword list is likely to be noisy, incomplete, and misleading.

The fix should remove the pretense of local hard-boundary enforcement from patch policy rather than replacing it with another string matcher.

Runtime validation should still enforce structural and product-specific rules: schema validity, evidence existence, chat ownership, action limits, selector validity, rate limits, and strong-review gates where accepted.

### 3. Derived Snapshots and Compasses Must Be Fully Derived Locally

The state-evolution pass may use AI to propose evidence-backed patches and possibly intermediate analysis, but the durable derived state must not be copied from AI snapshot fields when it can be computed from persisted source state.

Required direction:

- bot political compass is derived locally from persisted `BotPoliticalState.positions`;
- user political compass is derived locally from persisted active/contested/inactive `UserPoliticalProfile.notes`;
- bot personality snapshot is derived locally from persisted personality signals;
- user descriptive profile fields are derived locally from persisted social profile signals and recent evidence where needed;
- rejected or escalated patches cannot influence derived fields through a parallel AI snapshot.

If a first implementation cannot derive every field with high quality, it should still make the derived function deterministic and conservative rather than trusting AI-written snapshots. Low-confidence or sparse source state should produce neutral/empty defaults.

### 4. Summaries Use `is_active`

The summary reset fix should use an `is_active` style append-and-flag model. Reads should return the active/latest summary. Reset should mark existing summary rows inactive rather than physically deleting them.

## Problem Model

### Privacy and Cross-Chat Boundaries

The behavior pipeline trusts selected message IDs returned by AI gate/decision state and later fetches those IDs by global `messages.id`. If a selected ID belongs to another chat, the current assemblers can merge that message into the prompt context for the wrong chat.

Why this matters:

- prompt context can leak message content from one Telegram chat into another;
- state patches may cite evidence from a different chat;
- executor selectors can resolve a stored ID from another chat and then send a reaction/reply in the current chat using a Telegram-local message ID that may point at a different message or fail;
- state evolution can amplify the leak because it rehydrates message IDs from stored behavior events.

Target behavior:

- all message ID lookups used for behavior context are scoped by `chatId`;
- selected IDs that do not resolve in the current chat are dropped from prompt context and selector scopes;
- invalid/cross-chat IDs should be logged in a focused way, without dumping private prompt content.

### Prompt Logging Boolean Bug

`LOG_PROMPTS` currently uses `z.coerce.boolean()`. In JavaScript, non-empty strings are truthy, so dotenv values like `LOG_PROMPTS=false` can become `true`.

Why this matters:

- `.env.example` shows `LOG_PROMPTS=false`, which should mean disabled;
- when enabled, prompt logging can append message snippets, user profiles, political/personality state, hidden prompts, and model outputs to `prompts.log`;
- `.gitignore` lowers commit risk but does not eliminate local disk privacy risk.

Target behavior:

- only explicit `true` / `1` enable prompt logging;
- `false` / `0` / unset disable it;
- unrecognized values should fail config parsing rather than silently enabling logging.

### Evidence Validation

Patch policy currently checks only that `patch.evidence.messageIds` is non-empty. It does not verify that IDs exist, belong to the current chat, or appeared in the bounded context the AI saw.

Why this matters:

- durable truths, user labels, grudges, political notes, and personality signals can cite nonexistent evidence;
- cross-chat evidence can poison state in the wrong chat;
- later export/debug/evolution workflows may treat invalid evidence as trusted;
- reversibility depends on evidence resolving to actual stored messages.

Target behavior:

- each patch's evidence IDs must resolve to messages in the current chat;
- ideally evidence IDs must also be part of the bounded context shown to the model for that decision/pass;
- invalid evidence rejects only the offending patch;
- unrelated valid actions and patches continue.

### State-Evolution Cursor Data Loss

The current state-evolution pass reads events, calls the model, writes an evolution event, then advances the cursor to `Math.max(maxReadEventId, behaviorEventId)`. The evolution event is written after the model call, so it usually has a higher ID than all events read before the call.

The race:

1. Pass reads events up to ID `100`.
2. Model call takes several seconds.
3. Live chat events arrive and are logged as IDs `101`, `102`, `103`.
4. Pass writes its own state-evolution event as ID `104`.
5. Cursor advances to `104`.
6. Next pass reads only `id > 104`.

Events `101-103` are never reconciled into personality/political state.

Why this matters:

- busy chats lose exactly the social signal that state evolution is meant to capture;
- the loss is silent;
- the busier the chat during model latency, the more likely the bug.

Target behavior:

- the pass advances the cursor only to the high-water mark it actually read before the AI call;
- live events inserted during the call remain above the cursor for the next pass;
- the pass's own `modelSlot='stateEvolution'` event must not self-trigger a new pass.

### State-Evolution Self-Trigger

Trigger and sweep queries currently count all behavior events after the cursor. Once the cursor stops leapfrogging its own evolution event, the evolution event can become visible as "new work" unless queries filter it out.

Why this matters:

- fixing cursor data loss naively can introduce a self-trigger loop;
- self-trigger noise wastes model calls and can obscure real cadence behavior.

Target behavior:

- trigger thresholds and sweep queries count only live behavior events, not `modelSlot='stateEvolution'`;
- the pass may still read and ignore its own rows defensively, but own rows should not schedule work.

### AI Snapshots Bypass Patch Policy

The state-evolution pass applies evolution patches through policy, but then writes AI-provided snapshots/compasses from the same model output. That means a rejected or escalated patch can still affect durable derived state through the snapshot fields.

Example:

- `personality.add_signal` is rejected for low confidence;
- the same AI response includes `personalitySnapshot.values = ["same unsupported trait"]`;
- current code can still write the snapshot to `bot_personality_states`.

Why this matters:

- policy says "do not persist this change";
- snapshot write persists the effect anyway;
- future prompts consume the derived state, so the bypass directly changes behavior.

Target behavior:

- derived state is recomputed locally from already-persisted, accepted source state;
- AI snapshot fields should be removed from the durable write path or treated only as non-persistent hints/tests;
- if source evidence is sparse, derivation should keep neutral/empty defaults.

### Political and Personality Derivation

The original spec says compasses and descriptive fields are derived. Current implementation clamps AI-proposed compass numbers, but clamping is not derivation.

Why this matters:

- a compass can move even when no accepted position/note supports the movement;
- user political notes can change while compass stays stale if the AI omits a snapshot;
- qualitative source of truth and numeric projection can diverge.

Target behavior:

- define deterministic local derivation functions;
- use persisted source state as the only source of durable derived values;
- keep derivation simple and conservative for v1;
- add tests for empty, weak, moderate, strong, radical, contested, softened, reversed, and inactive inputs where applicable.

### Strong-Model Review Is Still an Open Decision

The audits disagree with the current implementation because the original spec says political patches and high-impact personality changes are reviewed by the stronger model before application. Current code escalates only radical political patches or radicalizing adjustments.

This needs a product/architecture decision before implementation.

#### Interpretation A: Strict Spec

All political patches require strong-model review before application. High-impact personality changes also require strong-model review.

Pros:

- matches the written spec most directly;
- lowers risk of cheap-model drift in politics/personality;
- simple to reason about in patch policy: political state is high-impact by category.

Cons:

- more strong-model calls;
- state evolution becomes slower/more expensive in politically active chats;
- the system may feel less adaptive if many passes require escalation.

#### Interpretation B: Risk-Tiered Review

Only political patches above a defined risk threshold require strong-model review. Examples: radical/strong intensity, major compass movement, protected-class-adjacent topics, or high-confidence ideological shifts. Low-risk uncertainty notes or weak/contested observations can stay on the default model.

Pros:

- cheaper and faster;
- more nuanced than "all politics is high risk";
- aligns with the existing attempt to escalate radical changes first.

Cons:

- requires a local risk classifier that must be specified and tested;
- easy to under-classify risky patches;
- harder to audit than a category-wide rule.

#### Why the Decision Matters

This decision changes model routing, patch policy, expected costs, and tests. It should be made before an implementation plan is written for the state-evolution review slice.

Until decided, the spec should not require one implementation. It should require that the eventual plan makes the chosen rule explicit and verifies that unreviewed disallowed patches cannot apply.

### Independent Validation and Partial Application

The current behavior decision validator parses the full decision as one strict schema. If one action has an invalid shape, the whole decision is rejected.

Why this matters:

- a malformed optional reaction can discard valid state patches;
- one invalid patch can suppress valid visible actions;
- this violates the intended partial-application model.

Target behavior:

- parse a minimal decision envelope first;
- validate actions independently;
- validate patches independently;
- drop/reject invalid elements with reasons;
- continue with valid unrelated elements.

This does not require a local text-safety keyword filter.

### Graceful Shutdown

Current shutdown only stops the Telegram messenger. The state-evolution scheduler, topic scheduler tasks, HTTP server, and gate batch timers may continue or be abandoned.

Why this matters:

- work can continue after the app is considered stopped;
- pending non-triggered message batches can be lost before gate evaluation;
- open HTTP server handles can keep the process alive;
- tests and deployments get less predictable lifecycle behavior.

Target behavior:

- shutdown stops Telegram polling/webhook handling;
- state-evolution scheduler stops;
- topic-of-day scheduled tasks stop;
- HTTP server closes;
- behavior gate batcher either flushes pending batches or explicitly drops them with an observable reason;
- shutdown path is awaitable.

### Runtime Observability

Many runtime failures are stored only as nested action/patch results inside behavior events. The separate `ai_error_events` journal remains underused.

Why this matters:

- repair agents need a focused error queue;
- Telegram action failures, invalid selectors, invalid evidence, and patch rejections are operationally important;
- nested JSON inside behavior events is harder to query and triage.

Target behavior:

- keep behavior event JSON as the per-decision audit trail;
- also write compact `ai_error_events` for repair-worthy failures;
- store IDs, component, operation, reason, and fix hints;
- avoid full private prompt/message dumps.

### Ignored Gate Decisions

When the gate says `shouldDecide: false`, no behavior event is stored.

Why this matters:

- there is no durable audit trail for gate confidence/reason/cost;
- false negatives are hard to inspect;
- state-evolution cadence sees only full decisions, not gate-level risk distribution.

Target behavior:

- store lightweight ignored-gate events, or a separate gate-event log if later chosen;
- include gate metadata and model usage;
- keep actions/patches empty.

### Append-And-Flag Summaries

Reset currently soft-deletes messages but hard-deletes summaries.

Why this matters:

- summary history is no longer inspectable;
- it violates the "no hard deletes" rule;
- future evidence/debug paths may need to know what summary existed before reset.

Target behavior:

- add `is_active` to summaries or equivalent active flag model;
- active summary reads ignore inactive rows;
- reset marks summaries inactive, not deleted.

## Required Behavior Changes

### Privacy and Context Integrity

- `LOG_PROMPTS` parsing is explicit and safe.
- Behavior context and state-evolution context never include selected messages from another chat.
- Selector scopes are sanitized to current-chat message IDs.
- Patch evidence IDs are verified against current-chat, model-visible context.

### State Evolution

- Cursor advancement never skips live events inserted during the AI call.
- Trigger and sweep count only live events.
- Evolution events are anchored to processed evidence/context rather than empty arrays.
- Derived snapshots/compasses are computed locally from accepted persisted state.
- Strong-model review behavior remains unresolved until the open decision is answered.

### Validation and Execution

- Invalid actions/patches are handled independently.
- Valid unrelated actions/patches continue.
- Local `hitsHardBoundary` string checking is removed and not replaced with a keyword filter.
- Structural validation, evidence validation, selector validation, rate limits, and model-review gates remain runtime responsibilities.

### Lifecycle and Observability

- Shutdown is awaitable and stops all long-lived runtime handles.
- Pending gate batches are handled explicitly on shutdown.
- Runtime failures get focused `ai_error_events`.
- Ignored gates get durable audit records.

### Data Integrity and Cleanup

- Summary reset uses `is_active`.
- DB constraints are strengthened where feasible.
- Gate reason contract is aligned with spec (`attitude_to_carl`) unless the original behavior spec is updated instead.
- Production-dead prompt surfaces and stale README references are cleaned up in a low-risk slice.

## Planning Slices

Future sessions should create implementation plans from these slices.

### Slice 1: Privacy and Evidence Boundaries

Scope:

- `LOG_PROMPTS` boolean parsing;
- chat-scoped message lookup APIs;
- context assembler sanitization;
- patch evidence validation;
- focused `ai_error_events` for invalid/cross-chat IDs.

Why first: it closes privacy and state-contamination risks.

### Slice 2: State-Evolution Cursor and Event Accounting

Scope:

- cursor high-water fix;
- live-event count API;
- sweep filter;
- evolution-event anchors;
- ignored-gate event logging if needed for cadence observability.

Why second: it prevents silent loss of live events and avoids self-trigger loops.

### Slice 3: Deterministic Derivation

Scope:

- local bot compass derivation from positions;
- local user compass derivation from political notes;
- local personality snapshot derivation from personality signals;
- local user descriptive-field derivation from social signals;
- removal of durable AI snapshot writes.

Why separate: this is deeper domain logic and needs its own tests and review.

### Slice 4: Independent Validation and Review Policy

Scope:

- independent action/patch validation;
- removal of `hitsHardBoundary` and associated config;
- strong-model review implementation after the open decision is answered;
- runtime rejection/escalation behavior for unreviewed disallowed patches.

Why separate: this touches AI contract handling and may change cost/routing.

### Slice 5: Shutdown and Operational Error Journal

Scope:

- awaitable shutdown;
- stop state-evolution scheduler;
- stop topic scheduler tasks;
- close HTTP server;
- drain or explicitly drop pending gate batches;
- log repair-worthy runtime failures to `ai_error_events`.

Why separate: lifecycle changes cross application entrypoint and runtime services.

### Slice 6: Storage Integrity, Contract Drift, and Dead Code

Scope:

- summary `is_active`;
- feasible DB checks/FKs;
- `attitude_to_carl` enum alignment;
- dead prompt methods/files;
- stale README references;
- rate-limiter stale bucket cleanup.

Why last: mostly hardening/cleanup after correctness and privacy issues.

## Acceptance Criteria

- `LOG_PROMPTS=false`, `LOG_PROMPTS=0`, and unset `LOG_PROMPTS` disable prompt logging.
- Behavior and evolution context assemblers cannot include selected messages from another chat.
- Patches with nonexistent, cross-chat, or not-in-context evidence IDs are rejected independently.
- State-evolution cursor does not advance past live events that arrived during the model call.
- State-evolution trigger and sweep ignore `modelSlot='stateEvolution'` rows for scheduling.
- Evolution behavior events include meaningful anchors for processed context/evidence.
- Durable derived personality/profile/compass fields are locally computed from accepted persisted source state.
- Invalid action/patch elements do not reject the entire decision.
- `hitsHardBoundary` substring filtering and `hardBoundaryTerms` config are removed or made unused with no replacement keyword filter.
- Shutdown closes/stops Telegram, state-evolution scheduler, topic scheduler tasks, HTTP server, and gate batch timers.
- Repair-worthy runtime failures are written to `ai_error_events` without full prompt/private dumps.
- Ignored gate decisions have a durable audit record.
- Summary reset marks summaries inactive instead of deleting rows.
- Full verification for each implementation plan includes focused tests, `pnpm test`, `pnpm type:check`, and `pnpm build`.

## Open Decisions

### OD1: Strong-Model Review Scope

Decision needed before Slice 4:

- strict spec: all political patches and high-impact personality patches require strong-model review;
- risk-tiered: only defined high-risk political/personality changes require strong-model review.

The chosen rule must be explicit in the implementation plan and enforced both in model routing and patch application.

### OD2: Personality/User Descriptive Derivation Heuristics

The spec requires full local derivation, but the exact heuristics can be simple v1 rules.

Decision needed before Slice 3:

- derive only conservative enum/string summaries from accumulated signals;
- or use a richer deterministic scoring model for tone, humor, verbosity, formality, interests, conflict style, and preferred tone.

Recommendation: start conservative and deterministic, then tune after tests show the source-state mapping clearly.

## Verification Strategy

Each slice plan should use TDD where practical:

- write focused failing tests for the audit symptom;
- implement minimal code;
- run focused tests;
- run `pnpm test`, `pnpm type:check`, and `pnpm build` before claiming completion.

Additional checks by slice:

- migration slices must include migration up/down tests;
- derivation slices must include table-driven tests for empty/weak/strong/contested/inactive source state;
- shutdown slice must test timers/tasks are stopped and no pending handles are left by the new shutdown API where feasible;
- observability slice must assert `ai_error_events` contain IDs/reasons and not full private prompt bodies.

## Handoff Rule

Do not implement directly from this spec in the same session that writes it. Future sessions should first choose a slice, resolve any open decision for that slice, then create a detailed implementation plan under `docs/superpowers/plans/`.
