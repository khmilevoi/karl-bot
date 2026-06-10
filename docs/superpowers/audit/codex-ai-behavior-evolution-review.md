# Code Review: AI Behavior Evolution

Spec: `docs/superpowers/specs/2026-05-28-ai-behavior-evolution-design.md`

Scope reviewed:

- behavior gate, batching, decision pipeline, context assembly;
- decision validation, action execution, rate limits;
- live and evolution patch policy/application;
- OpenAI adapter/model routing/prompt logging;
- SQLite repositories and migrations related to the behavior design.

Verification:

- `.\node_modules\.bin\vitest.CMD run` passed: 57 test files, 293 tests.
- Static complexity scanner was run; most reported hotspots are bounded prompt/state loops and were treated as leads, not findings.
- No application code was changed.

## Findings

### 1. Critical/Security: `LOG_PROMPTS=false` enables full prompt logging

Files:

- `src/infrastructure/config/envSchema.ts:12`
- `.env.example:7`
- `src/infrastructure/external/ChatGPTService.ts:445-465`

`LOG_PROMPTS` is parsed with `z.coerce.boolean()`. In Zod, string values such as `"false"` and `"0"` coerce through JavaScript truthiness, so `"false"` becomes `true`. The example configuration sets `LOG_PROMPTS=false`, which in a real dotenv environment enables `ChatGPTService.logPrompt()`.

Impact:

- full Telegram message history snippets, user profiles, political/personality state, hidden system prompts, and model outputs are appended to `prompts.log`;
- this directly conflicts with the spec's privacy boundary and the AI-error-log rule to avoid full private dumps;
- `.gitignore` prevents accidental commit, but local disk exposure is still a security/privacy problem.

Recommendation:

- parse booleans explicitly, e.g. accept only `true` / `1` as true and `false` / `0` as false;
- add a regression test for `LOG_PROMPTS='false'`.

### 2. High/Security: selected message IDs are fetched without enforcing chat ownership

Files:

- `src/application/behavior/DefaultBehaviorContextAssembler.ts:112-151`
- `src/application/behavior/DefaultStateEvolutionContextAssembler.ts:133-166`
- `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts:89-99`

The gate and behavior event IDs are trusted, then fetched by global `messages.id`. The assembler merges fetched messages when `m.id != null && m.chatId != null`, but it does not require `m.chatId === input.chatId`.

Impact:

- a hallucinated or poisoned ID can pull messages from another chat into the prompt context;
- state evolution can repeat the leak because it rehydrates IDs from stored behavior events;
- executor selectors may then target a cross-chat message's Telegram `message_id` while sending the action to the current chat, which can react/reply to the wrong local message ID or fail unpredictably.

Recommendation:

- change repository API or assembler filtering so selected IDs are scoped by `chatId`;
- reject or drop any gate/context ID that does not resolve to the current chat;
- log an `ai_error_event` for cross-chat or missing IDs.

### 3. High/Security: patch evidence IDs are not validated against current chat/context

Files:

- `src/application/behavior/DefaultBehaviorDecisionValidator.ts:29-107`
- `src/application/behavior/DefaultPatchPolicy.ts:17-20`
- `src/application/behavior/DefaultStatePatchApplicator.ts:92-117`
- `src/application/behavior/DefaultStatePatchApplicator.ts:241-368`

The spec says `evidenceMessageIds` must resolve against the bot's own message store and runtime policy must validate required evidence. Current policy only checks that `patch.evidence.messageIds.length > 0`. It does not verify existence, chat ownership, active/inactive semantics, or whether the ID appeared in the prompt context.

Impact:

- durable truths, social signals, political notes, and personality signals can be stored with nonexistent or cross-chat evidence;
- later context assembly and export workflows may treat poisoned evidence as legitimate;
- reversibility and auditability degrade because the evidence trail may not resolve.

Recommendation:

- validate evidence IDs before applying any patch;
- require evidence IDs to belong to the same chat and preferably to the bounded context shown to the model;
- reject patches with unresolved IDs independently and record the reason.

### 4. High/Security: visible replies/questions have no runtime hard-safety validation

Files:

- `src/application/behavior/DefaultBehaviorDecisionValidator.ts:47-103`
- `src/application/behavior/DefaultPatchPolicy.ts:22-24`
- `src/application/behavior/BehaviorConfig.ts:59-69`

The validator enforces reply length, empty text, duplicate actions, and allowed reaction emoji. It does not inspect `reply.text` or `ask_question.text` for the hard safety floor. The hard-boundary check exists only in `PatchPolicy`, and only as a substring check over patch text.

Impact:

- unsafe visible content can be sent if the model emits it in an otherwise schema-valid action;
- this violates the spec fallback: unsafe hard-boundary content must reject the unsafe visible action or patch;
- prompt-only safety is not enough for the stated runtime policy.

Recommendation:

- add runtime visible-action policy checks before execution;
- keep action rejection independent so safe actions/patches can still apply;
- use a structured policy layer rather than only the current phrase-list substring filter.

### 5. High/Logic/Security: state-evolution snapshots bypass patch policy

Files:

- `src/application/behavior/DefaultStateEvolutionPass.ts:163-186`
- `src/application/behavior/DefaultStateEvolutionPass.ts:204-319`
- `src/application/behavior/DefaultStatePatchApplicator.ts:390-683`

`DefaultStateEvolutionPass.run()` applies evolution patches through policy, but then unconditionally writes `personalitySnapshot`, `botCompass`, `userSnapshots`, and `userPoliticalSnapshots` from the same AI output. Rejected or escalated patches do not stop the corresponding derived snapshot from being persisted.

Impact:

- a low-confidence or hard-boundary `personality.add_signal` can be rejected while its trait still appears in `bot_personality_states`;
- a political patch can be rejected/escalated while `bot_political_states.compass` is still overwritten;
- runtime policy is bypassed for the rendered state that actually influences future behavior.

Recommendation:

- derive snapshots from already-persisted, policy-approved source state, or validate that snapshots are consistent with accepted patches/signals;
- do not write derived fields affected by rejected/escalated patches in the same run;
- add tests where a rejected evolution patch attempts to alter snapshots.

### 6. High/Logic: political compasses are AI-written snapshots, not verified derivations

Files:

- `src/domain/behavior/schemas/evolution.ts:24-35`
- `src/application/behavior/DefaultStateEvolutionPass.ts:233-255`
- `src/application/behavior/DefaultStateEvolutionPass.ts:293-318`

The spec says bot compass is derived from `positions[]`, and user compass is derived from active political notes. Current code asks the model to output `botCompass` and `userPoliticalSnapshots`, clamps bounds, and writes them directly. There is no deterministic derivation or consistency check against positions/notes.

Impact:

- compasses can diverge from the qualitative political source of truth;
- missing `userPoliticalSnapshots` leaves notes updated but compass stale;
- arbitrary compass movement is possible even when no position/note patch was accepted.

Recommendation:

- implement local derivation from persisted positions/notes, or at least verify AI-proposed compasses against those sources;
- treat clamp as a bounds guard only, not as derivation validation.

### 7. High/Logic: required strong-model review is incomplete for political/high-impact evolution patches

Files:

- `src/infrastructure/external/ChatGPTService.ts:272-301`
- `src/application/behavior/DefaultPatchPolicy.ts:27-58`
- `src/application/behavior/DefaultStatePatchApplicator.ts:445-592`

The spec says political patches and high-impact personality changes are reviewed by the stronger model before application. Current escalation only re-runs state evolution for radical political patches or `radicalize` adjustments. A `politics.add_position` with `requestedIntensity: 'strong'` and confidence >= `0.7` can be accepted on the default model.

Impact:

- strong political state can be persisted without the required stronger-model review;
- high-impact personality changes have no explicit high-impact classification or review path;
- model routing does not match the risk policy in the spec.

Recommendation:

- require strong-model review for all political patches, or define and enforce a narrower reviewed subset explicitly;
- add a policy result for high-impact personality signals and route them through the escalation model before applying.

### 8. Medium/Logic: structurally invalid actions reject the whole decision

Files:

- `src/application/behavior/DefaultBehaviorDecisionValidator.ts:29-39`
- `src/domain/behavior/schemas/decision.ts:8-13`
- `src/domain/behavior/schemas/actions.ts:85-90`

The validator parses the whole `BehaviorDecision` with a discriminated union. If one action has an invalid shape or unknown type, `safeParse` fails and the pipeline rejects the entire decision. The spec fallback says an invalid action should drop only that action; valid actions and valid state patches should continue independently.

Impact:

- one malformed action can discard valid truth/user-profile patches;
- a single malformed optional action can suppress an otherwise useful reply or reaction;
- this weakens the partial-application guarantees.

Recommendation:

- parse the decision envelope separately from actions;
- validate action elements independently and drop invalid ones into `droppedActions`;
- preserve valid `statePatches` unless those patches fail their own validation/policy.

### 9. Medium/Observability: runtime failures are not written to `ai_error_events`

Files:

- `src/application/behavior/DefaultBehaviorExecutor.ts:107-118`
- `src/application/behavior/DefaultBehaviorExecutor.ts:167-186`
- `src/application/behavior/DefaultBehaviorPipeline.ts:253-272`
- `src/application/behavior/DefaultStatePatchApplicator.ts:92-145`

Telegram action failures and patch rejections are returned as action/patch results and then stored inside `behavior_events`. They are not recorded in `ai_error_events`. The spec explicitly calls for AI-agent-friendly error logs for sources such as `telegram_action`, validation, patch policy, and OpenAI failures.

Impact:

- repair agents cannot query a focused error journal for failed Telegram reactions/actions or patch policy failures;
- repeated runtime failures are buried in nested JSON inside behavior events;
- the `ai_error_events` table under-represents actual operational failures.

Recommendation:

- log structured `ai_error_events` for failed Telegram actions, rejected unsafe patches, invalid target selectors, and repeated validation failures;
- keep behavior event result JSON as the per-decision audit trail, but also populate the repair journal.

### 10. Medium/Data Integrity: summary reset hard-deletes rows

Files:

- `src/application/use-cases/chat/DefaultChatResetService.ts:29-33`
- `src/infrastructure/persistence/sqlite/SQLiteSummaryRepository.ts:32-35`

The spec says the database should be append-and-flag and no row should be physically deleted from any table. `reset()` soft-deletes messages via `is_active = 0`, but then calls `DELETE FROM summaries WHERE chat_id = ?`.

Impact:

- summary history is not inspectable after reset;
- this is inconsistent with the no-hard-delete rule and the evidence-preservation model.

Recommendation:

- add an `is_active` or superseded/versioned summary model;
- mark summaries inactive or superseded instead of deleting them.

### 11. Medium/Spec Gap: `summarize_thread` never enqueues real work

Files:

- `src/application/behavior/BehaviorConfig.ts:97-104`
- `src/application/behavior/DefaultBehaviorSummarizationQueue.ts:28-41`
- `src/application/behavior/DefaultBehaviorExecutor.ts:192-209`

The spec says `summarize_thread` should enqueue the single background summarizer. The default queue config is `enabled: false`, and the implementation returns `deferred` with reason `summarize_thread worker deferred until dedicated plan`.

Impact:

- a valid model action cannot actually request summarization;
- behavior events will say the action was deferred, but there is no worker path to complete it;
- conversations can keep growing without the tool the behavior contract advertises.

Recommendation:

- either remove `summarize_thread` from the allowed action schema until implemented, or enable a real queue/worker path.

### 12. Low/Contract Drift: gate reason uses `attitude_to_bot` instead of `attitude_to_carl`

Files:

- `src/domain/behavior/schemas/gate.ts:10-20`
- `test/behaviorJsonSchema.test.ts:120-136`
- spec section `BehaviorGateDecision`

The spec names the gate reason `attitude_to_carl`; the schema and tests use `attitude_to_bot`. The prompt text says "attitudes toward Carl", but the strict schema exposes the different enum.

Impact:

- logs and downstream analytics do not match the approved contract;
- future code or prompts written against the spec may use the wrong enum.

Recommendation:

- align the enum with the spec, or update the spec and all prompt language consistently.

### 13. Low/Observability: ignored gate decisions are not logged as behavior events

Files:

- `src/application/behavior/DefaultBehaviorPipeline.ts:137-140`
- `src/application/behavior/DefaultBehaviorEventLogger.ts:26-60`

When the gate returns `shouldDecide: false`, the pipeline returns `{ kind: 'ignored', gate }` and stores no behavior event. The spec says `behavior_events` stores every AI decision, validation result, and applied/ignored action.

Impact:

- no durable audit trail for gate cost, confidence, reason, or false negatives;
- state-evolution cadence only sees full decision events, not gate decisions that might still indicate risk distribution.

Recommendation:

- add a lightweight behavior event or a separate gate event log for ignored gate decisions.

### 14. Low/Performance: rate-limiter buckets can grow by chat count indefinitely

Files:

- `src/application/behavior/DefaultBehaviorRateLimiter.ts:17-19`
- `src/application/behavior/DefaultBehaviorRateLimiter.ts:77-98`

Each limiter bucket is pruned only when that same chat is checked again. Chats that become inactive remain in the maps forever.

Impact:

- long-lived bot processes with many one-off chats accumulate stale map entries;
- per-entry arrays are small, so this is low severity, but it is avoidable memory growth.

Recommendation:

- delete chat keys when pruning leaves no hits;
- optionally run periodic cleanup for inactive buckets.

## Dead Code Addendum

Checks run:

- `oxlint` completed with no findings.
- `tsc --noEmit --noUnusedLocals --noUnusedParameters` found two unused symbols.
- Manual `rg` audit for the retired legacy answer flow found no production `DefaultChatResponder`, `ChatMemory`, `InterestChecker`, `InterestMessageStore`, `AIService.ask`, `checkInterest`, or `assessUsers` references in `src`.

### D1. Low/Dead code: unused `EnvService` injection in `DefaultChatApprovalService`

Files:

- `src/application/use-cases/chat/DefaultChatApprovalService.ts:4-8`
- `src/application/use-cases/chat/DefaultChatApprovalService.ts:25`
- `src/application/use-cases/chat/DefaultChatApprovalService.ts:31-35`

`DefaultChatApprovalService` injects `EnvService`, assigns `envService.env` to `private env`, and never reads it. TypeScript reports this under `--noUnusedLocals`.

Impact:

- unnecessary DI dependency and import surface;
- misleading signal that chat approval behavior depends on runtime env config.

Recommendation:

- remove the `Env` import, `ENV_SERVICE_ID`/`EnvService` injection, and `env` field unless an env-dependent approval rule is intentionally planned.

### D2. Low/Dead code: unused `ctx` parameter in the `adminChats` menu builder

File:

- `src/view/telegram/routes.ts:361`

The dynamic menu callback is declared as `.dynamic(async (ctx, range) => ...)`, but `ctx` is not read. TypeScript reports this under `--noUnusedParameters`.

Impact:

- minor dead parameter noise;
- makes stricter unused checks fail.

Recommendation:

- rename the parameter to `_ctx` if grammY requires the arity, or remove it if the callback signature allows that locally.

### D3. Low/Post-cutover dead API: `MessageFactory.fromAssistant` is test-only

Files:

- `src/application/use-cases/messages/MessageFactory.ts:38-50`
- `test/MessageFactory.test.ts:53-60`

After the behavior-pipeline cutover, assistant replies are sent through `BehaviorExecutor`/`ChatMessenger`; production code no longer stores assistant messages through `MessageFactory.fromAssistant`. The only remaining caller is its unit test.

Impact:

- dead API can mislead future work into thinking assistant replies are still persisted through the old message factory path;
- if assistant-message persistence is desired, this method being unused indicates that persistence is currently not wired.

Recommendation:

- remove `fromAssistant` and its test if assistant outgoing messages should stay non-persisted;
- otherwise wire assistant sends through an explicit persistence path and keep this helper only if that path uses it.

### D4. Low/Post-cutover dead prompt surface: old prompt-system methods and files are not used by production prompt directors

Files:

- `src/application/prompts/PromptBuilder.ts:88-94`
- `src/application/prompts/PromptBuilder.ts:117-124`
- `src/application/interfaces/env/EnvService.ts:19-21`
- `src/infrastructure/config/DefaultEnvService.ts:51-53`
- `src/infrastructure/config/TestEnvService.ts:57-59`
- `prompts/user_prompt_system_prompt.md`
- `prompts/priority_rules_system_prompt.md`

`addUserPromptSystem`, `addPriorityRulesSystem`, and their prompt file entries remain in the shared prompt/env surface, but current production prompt construction does not call them. The remaining references are tests and config declarations.

Impact:

- old prompt paths stay visible as if they still affect runtime AI behavior;
- future changes may edit the wrong prompt files and see no production effect.

Recommendation:

- remove these prompt entries and builder methods if the legacy answer flow is permanently retired;
- if they are intentionally reserved for a future feature, mark them explicitly as unused/future-facing and keep them out of current behavior documentation.

### D5. Low/Test-only public method: `DefaultBehaviorSummarizationQueue.peek`

Files:

- `src/application/behavior/DefaultBehaviorSummarizationQueue.ts:44-46`
- `test/BehaviorSummarizationQueue.test.ts:34-64`

`peek(chatId)` is a public method on the concrete queue class, but it is not part of `BehaviorSummarizationQueue` and is only called from tests. The queue itself is still reachable through `summarize_thread`, so this is limited to the extra concrete-class API.

Impact:

- exposes a public method that production code cannot depend on through the interface;
- reinforces a queue inspection API before a real worker/consumer contract exists.

Recommendation:

- remove `peek` or make it a private/test-only helper unless the future summarization worker is expected to use this exact API;
- if a worker will consume queued requests, add that operation to the interface instead of leaving it only on the implementation.

### D6. Low/Documentation drift: README still describes removed legacy artifacts

Files:

- `README.md:13`
- `README.md:100`
- `README.md:165`

The README still references `prompts/persona.md`, `src/application/use-cases/chat/ChatMemory.ts`, and `chat_configs.interest_interval`. These artifacts were removed or retired by the behavior-system cutover and migration `017`.

Impact:

- not executable dead code, but stale documentation can send maintainers toward deleted paths;
- increases risk of reintroducing legacy concepts during follow-up work.

Recommendation:

- update README sections to describe the behavior pipeline, current prompt files, and current chat config schema.
