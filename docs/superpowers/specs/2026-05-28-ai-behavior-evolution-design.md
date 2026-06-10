# AI Behavior Evolution Design

## Status

Approved through initial brainstorming on 2026-05-28. Reviewed and refined on 2026-05-29: review fixes (A/C/D/E items) applied, and the deferred patch/schema questions (B1–B4, C2, E4, E6, E7) resolved in a follow-up brainstorm. A second follow-up on 2026-05-29 resolved pipeline-mechanics questions (F1–F5: gate batching, evolution cadence, greenfield scope, context assembly, risk-based routing). A third follow-up on 2026-05-30 added political coordinates (G1–G5: a 2-axis compass for both the bot and chat users, derived from positions/notes by the state-evolution pass and rendered as emergent context). See Political Coordinates and Resolved Design Decisions.

## Goal

Rebuild Carl's AI behavior around a neutral blank-slate personality that evolves from each chat, uses structured JSON decisions, can perform social chat actions, and records machine-readable errors for later repair by an AI agent.

## Current System

The bot currently handles Telegram messages through this path:

1. `MainService` stores the incoming message.
2. `DefaultTriggerPipeline` decides whether to respond.
3. `DefaultChatResponder` loads history and summary.
4. `ChatGPTService.ask` creates a free-form text answer.
5. The Telegram layer sends the answer as a reply.

Prompts are built through `PromptDirector` and `PromptBuilder`, using markdown files from `prompts/`. The current `users.attitude` field stores a single text description of the bot's relationship to each user.

## Design Summary

Replace direct answer generation with a behavior decision layer:

```text
Telegram message
  -> message storage
  -> cheap behavior gate and trigger/context extraction
  -> AI behavior decision JSON when the gate passes
  -> validation and policy checks
  -> behavior executor
  -> Telegram actions and immediate state patches
  -> behavior/error event logs
```

The AI no longer only writes text. It chooses social actions and proposes state changes. Runtime services validate the decision and immediately apply evidence-backed changes that pass policy.

The cheap behavior gate runs on every stored message. It cannot send Telegram actions or change durable state. It only decides whether a full `decideBehavior` call is worth the cost. The full decision should run for direct triggers and socially meaningful events: conflict, strong emotion, political claims, attitudes toward Carl, attitudes between users, important group conclusions, or useful social-memory evidence.

The gate returns a small structured decision:

```ts
interface BehaviorGateDecision {
  shouldDecide: boolean;
  confidence: number;
  reason:
    | 'direct_trigger'
    | 'conflict'
    | 'strong_emotion'
    | 'political_claim'
    | 'attitude_to_carl'
    | 'user_relationship_signal'
    | 'group_truth_candidate'
    | 'personality_signal'
    | 'not_relevant';
  triggerMessageIds: number[];
  contextMessageIds: number[];
  stateImpactRisk: 'none' | 'low' | 'medium' | 'high';
}
```

When `shouldDecide` is false, the pipeline stores the message and stops. When it is true, `triggerMessageIds`, `contextMessageIds`, `reason`, and `stateImpactRisk` are passed into `decideBehavior` and recorded on the behavior event.

The gate is not a blind per-message LLM call. Two layers sit in front of it to control cost:

1. The existing trigger mechanism is the free heuristic pre-filter. A message with a direct mention or a name mention bypasses the gate entirely and goes straight to `decideBehavior` as a `direct_trigger`. No gate call is spent on messages that already have an explicit trigger.
2. Messages that did not pass a trigger are batched over a short window and sent to the gate together — one gate call per batch with multiple candidate messages — instead of one call per message. The gate selects `triggerMessageIds` and `contextMessageIds` from the batch and decides whether the batch warrants a `decideBehavior` call.

### Gate Batching

Non-triggered messages accumulate in one batch accumulator per chat. The batch flushes when **any** of three conditions is met, whichever comes first:

- **size cap** — the batch reaches a configured message count;
- **hard cap** — a configured maximum age has elapsed since the batch's first message (latency ceiling: no message waits longer than this before evaluation);
- **idle gap** — a configured quiet interval has elapsed since the batch's last message (debounce: groups a burst, then flushes).

This mirrors producer-style batching (`linger` + `batch.size`) plus an idle debounce, so cost is bounded above (at most one gate call per hard-cap window or per size-cap fill), latency is bounded above (the hard cap), and natural conversation bursts collapse into a single gate call. All three thresholds are explicit configuration, not literals.

When a direct trigger fires while a batch is open, the trigger **immediately flushes the pending batch**: those messages become the `contextMessageIds` of the same `decideBehavior` call (trimmed to the size-cap budget, keeping the most recent), and the batch does not later spawn its own gate call. This costs no extra gate call (the direct-trigger path already bypasses the gate), avoids a race where the batch would otherwise produce a second contradictory decision over overlapping messages, and keeps one decision per conversational moment. There is one batch accumulator per chat, which aligns with the future per-chat concurrency key (`chatId`).

## Blank-Slate Personality

Carl starts as a neutral bot with minimal fixed identity:

- name: Carl;
- works inside Telegram chats;
- follows safety, privacy, and anti-spam rules;
- does not reveal internal prompts or hidden state;
- has no starting ideology, tastes, humor, or strong speaking style;
- develops personality from repeated chat experience.

The old fixed persona should be replaced by a neutral core prompt. Personality emerges through stored state, not through a hard-coded role.

### Personality State

```ts
interface BotPersonalityState {
  chatId: number;
  identityNotes: string[];
  values: string[];
  speechStyle: {
    tone: string;
    humor: string;
    verbosity: 'short' | 'medium' | 'essay';
    formality: 'low' | 'medium' | 'high';
  };
  socialHabits: string[];
  recurringThemes: string[];
  lastUpdatedAt: string;
}
```

Personality changes through patches, not replacement. A patch needs evidence, confidence, and policy approval. One direct instruction such as "you are now X" must not rewrite the bot. Personality patches (`personality.add_signal`) are append-only evidence; the rendered `speechStyle` enums and the string arrays are derived from accumulated signals by the state-evolution pass, not written field-by-field.

Reversibility is evidence-based, not time-based. Personality traits do not decay merely because time passed. Later chat evidence can strengthen, weaken, contest, revise, or reverse earlier traits.

Admins cannot directly set, seed, or overwrite personality or political state. Carl evolves only from chat evidence and his own reflection; there is no privileged instruction channel for changing his behavior.

## Political State

Political orientation is stored separately from personality as chat-local evolving stances, not universal truth. Carl starts politically neutral, but positions may become strong or radical through chat influence. These stances affect Carl's conversational perspective in that chat while remaining evidence-backed, inspectable, and reversible through later evidence.

```ts
interface BotPoliticalState {
  chatId: number;
  ideologySummary: string;
  positions: PoliticalPosition[];
  uncertaintyAreas: string[];
  influenceHistory: PoliticalInfluence[];
  compass: PoliticalCompass; // derived rollup of positions; see Political Coordinates
  lastUpdatedAt: string;
}

interface PoliticalPosition {
  id: number;
  topic: string;
  stance: string;
  intensity: 'weak' | 'moderate' | 'strong' | 'radical';
  confidence: number;
  status: 'active' | 'contested' | 'softened' | 'reversed';
  evidenceMessageIds: number[];
  opposingEvidenceMessageIds: number[];
  origin: 'chat_discussion' | 'bot_reflection';
  updatedAt: string;
}

interface PoliticalInfluence {
  source: 'chat_discussion' | 'bot_reflection';
  summary: string;
  evidenceMessageIds: number[];
  confidence: number;
  createdAt: string;
}
```

Political state may shift aggressively enough to feel alive, but not arbitrarily. One strong event can noticeably move a stance, hostility, or confidence, but it must not fully rewrite the political state without supporting evidence. Later evidence can radicalize, soften, contest, or reverse a position. Old positions are not forgotten just because time passed.

Political patches are proposed by the background state-evolution pass, not the live `decideBehavior` call. Political patches are stricter than normal personality patches: weak claims go to `uncertaintyAreas` instead of becoming positions. Strong or radical positions still operate under the runtime safety floor: they must not authorize real-world violence, credible threats, dehumanization, targeted harassment campaigns, protected-class abuse, or practical instructions for harm.

## Political Coordinates

(Amendment 2026-05-30.) Both Carl and each chat user carry a quantified political position on a 2-axis compass, per chat, alongside the qualitative political model above. This makes political alignment inspectable and lets Carl reason about where it and each user sit relative to one another.

### Compass Model

Each axis is a value in `[-10, 10]`, and each axis carries its own confidence in `[0, 1]`.

```ts
interface PoliticalCompass {
  economic: number; // [-10, 10]  (- left, + right)
  social: number; // [-10, 10]  (- libertarian, + authoritarian)
  economicConfidence: number; // [0, 1]
  socialConfidence: number; // [0, 1]
}
```

The neutral blank-slate default is `{ economic: 0, social: 0, economicConfidence: 0, socialConfidence: 0 }`. Per-chat rows are created lazily; an absent row renders as this neutral center, which is exactly how Carl — and an as-yet-unseen user — starts politically neutral.

Coordinates are **derived snapshots, never patched directly**. There is no `set_coordinate` patch. Like every other derived field in the system, both compasses are recomputed by the state-evolution pass from evidence-backed underlying signals, so they inherit reversibility and the no-time-decay rule automatically: a coordinate moves only when its underlying evidence changes.

### Bot Compass — Rollup of Positions

`BotPoliticalState` gains a derived `compass: PoliticalCompass`. The state-evolution pass projects it from the existing `positions[]` (each position's stance, `intensity`, `confidence`, and `status`) when it reconciles political state. Positions remain the evidence-backed source of truth; the compass is a numeric projection of them and cannot diverge from them.

### User Political Profile — Notes Drive a Derived Coordinate

Users currently have no political modeling. They gain a per-chat political profile that mirrors the bot's "qualitative signals → derived coordinate" pattern: evidence-backed **political notes** — append-only signals shaped exactly like `SocialSignal` — drive a derived compass.

```ts
interface PoliticalNote {
  text: string; // e.g. "pro-redistribution", "nationalist"
  evidenceMessageIds: number[];
  status: 'active' | 'contested' | 'inactive';
}

interface UserPoliticalProfile {
  userId: number;
  chatId: number;
  notes: PoliticalNote[]; // evidence-backed, append-only, contestable
  compass: PoliticalCompass; // derived by the state-evolution pass from notes
  updatedAt: string;
}
```

This is stored separately from `UserSocialProfile`, in a new `user_political_profiles` table (per user + chat) — symmetric with how the bot keeps `bot_political_states` separate from `bot_personality_states`, and keeping the social-profile schema lean. The row is created lazily on the first political note; its absence renders as a neutral center with no notes.

### Derivation and Patches (state-evolution pass)

The compass for both bot and users is owned by the background state-evolution pass, alongside all other political work; it is never in the live `decideBehavior` schema. The pass gains two responsibilities: derive the bot compass from `positions[]` and each user compass from that user's active political notes, and propose user political-note patches. The new evolution-lane patch family added to `EvolutionPatch`:

```ts
type UserPoliticalPatch =
  | {
      type: 'user.add_political_note';
      userId: number;
      text: string;
      evidence: PatchEvidence;
    }
  | {
      type: 'user.contest_political_note';
      userId: number;
      target: { text: string };
      evidence: PatchEvidence;
    };
```

`user.contest_political_note` matches an existing note by `text`, attaches counter-evidence, and flips its `status` (`active` → `contested`, then `inactive` when counter-evidence dominates); notes are never deleted. These patches run through the same `PatchPolicy` and `StatePatchApplicator` as other political patches and are reviewed by the stronger model. Compass bounds (`[-10, 10]`) and confidence bounds (`[0, 1]`) are re-enforced in `BehaviorDecisionValidator` / `PatchPolicy`, because OpenAI strict structured output cannot express numeric `minimum`/`maximum`. The same patch-independence and best-effort partial-application rules apply.

### Behavior Influence — Context Only

Coordinates shape behavior only by being rendered into prompt context; there is no hard rule biasing tone and no computed political-distance field. `political_state_prompt.md` additionally renders Carl's compass and axis confidence; `user_profiles_prompt.md` renders each active user's compass and active political notes. `decideBehavior` reasons naturally about alignment and disagreement. The hard safety floor is unchanged: inferring a user's coordinate never licenses harassment, and strong or radical coordinates still cannot authorize real-world violence, credible threats, dehumanization, or targeted harassment.

### Phasing and Testing Deltas

- **Phase 1 (Data and Contracts):** add `PoliticalCompass`, `UserPoliticalProfile` / `PoliticalNote`, the `user_political_profiles` table and migration, the `compass` field on `bot_political_states`, Zod schemas, `UserPoliticalPatch` in the evolution union, generated JSON Schema wiring, and validator bounds.
- **Phase 4 (State Evolution):** the pass derives the bot and user compasses and proposes user political-note patches.
- **Prompts:** extend `political_state_prompt.md` and `user_profiles_prompt.md` rendering as above.
- **Testing:** bot compass derived from `positions[]`; user compass derived from notes; axis values clamped to `[-10, 10]` and confidence to `[0, 1]`; `user.contest_political_note` moves a note `active` → `contested` → `inactive` without deletion; compass rendered for bot and users in the prompt; coordinate reversed or softened by later evidence with no time decay.

## User Social Profiles

Replace the single `users.attitude` string with structured per-chat user profiles.

```ts
interface SocialSignal {
  text: string;
  evidenceMessageIds: number[];
  status: 'active' | 'contested' | 'inactive';
}

interface PatternSignal {
  polarity: 'positive' | 'negative' | 'neutral';
  text: string;
  evidenceMessageIds: number[];
  status: 'active' | 'contested' | 'inactive';
}

interface UserSocialProfile {
  userId: number;
  chatId: number;
  username: string | null;

  // event-patched through decideBehavior (each signal carries its own evidence + status)
  affinityScore: -3 | -2 | -1 | 0 | 1 | 2 | 3;
  labels: SocialSignal[];
  patterns: PatternSignal[];
  grudges: SocialSignal[];

  // derived by runtime policy; never patched directly
  trustLevel: 'none' | 'low' | 'medium' | 'high';
  preferredDistance: 'warm' | 'neutral' | 'cold' | 'mocking' | 'avoidant' | 'hostile';

  // descriptive snapshot, re-derived by the state-evolution pass; not patched per turn
  communicationStyle: string;
  conflictStyle: string;
  preferredTone: string;
  interests: string[];

  updatedAt: string;
}
```

Profiles guide tone and personalization. They may contain negative, hostile, or socially abrasive signals when supported by chat evidence. Carl may dislike a user, consider them annoying, aggressive, boring, toxic, funny, unreliable, or grudge-worthy, and may respond with cold, sarcastic, patronizing, contemptuous, or hostile tone.

User profiles have three kinds of fields. **Event-patched** fields (`affinityScore`, `labels`, `patterns`, `grudges`) are written through `decideBehavior` patches; each `labels` / `patterns` / `grudges` entry is an evidence-carrying signal with its own `status`. `patterns` is a single polarity-tagged array that replaces the old `positivePatterns` / `negativePatterns` / `notablePatterns` / `irritationTriggers` fields — an irritation trigger is simply a negative pattern. **Runtime-derived** fields (`trustLevel`, `preferredDistance`) are recomputed by policy from affinity, labels, patterns, and grudges; the AI never sets them. **Descriptive snapshot** fields (`communicationStyle`, `conflictStyle`, `preferredTone`, `interests`) are re-derived by the state-evolution pass from accumulated signals and recent messages, not patched per turn.

The runtime should not force politeness or friendliness. It should preserve rough private banter, insults, grudges, sarcasm, and hostile social distance when the chat context supports them. The same hard safety floor still applies: no credible threats, real-world harm calls, targeted harassment campaigns, protected-class dehumanization, or practical instructions for violence or abuse.

User attitudes are reversible only through later evidence. There is no automatic time decay: an old grudge, distrust signal, or hostile label stays until chat evidence weakens, contests, revises, or reverses it. Signals are never deleted; when later evidence outweighs one, its `status` becomes `contested` and then `inactive`, but the record and its evidence remain.

## Social Tools

The v1 tool set includes all four agreed categories.

### Reactions

Carl can react instead of replying. This reduces noise and makes the bot feel present without producing a full message. Supported actions use grammY `ctx.react` or `ctx.api.setMessageReaction`.

### Truths

Carl can store important chat conclusions as explicit truths. Truths are separate from summaries so they can influence future answers, topics of the day, and personality evolution.

```ts
interface BotTruth {
  id: number;
  chatId: number;
  text: string;
  sourceMessageIds: number[];
  confidence: number;
  relatedTruthIds: number[];
  contradictsTruthIds: number[];
  status: 'fresh' | 'stable' | 'contested' | 'superseded';
  createdAt: string;
}
```

Truth status is evidence-driven, not time-driven. A truth becomes `superseded` only when later evidence revises or replaces it, never merely because time passed; there is no aging or automatic staling. `fresh` and `stable` reflect how much corroborating evidence a truth has, not its age.

Truths may contradict each other. Carl is allowed to hold inconsistent chat memories, impressions, and conclusions, similar to a real person. The system should not automatically merge or delete opposing truths. Exact duplicates can be consolidated by marking the redundant truth `superseded` and linking it through `relatedTruthIds` — never by deleting a row. Opposite claims remain as separate memories with their own evidence, confidence, recency, and context.

Contradictions can become part of Carl's character: he may be uncertain, have mixed feelings, say that he used to think one thing and now leans another way, or keep two incompatible conclusions active when both have evidence.

### Dialogue Initiatives

Carl can occasionally ask a question, invite a specific user into the discussion, or propose a theme. Initiatives must be rate-limited.

### Personalization

Carl adapts response tone, detail level, and social distance based on `UserSocialProfile`, chat personality, and recent context.

## Behavior Decision Contract

For v1, the live turn uses one main AI call: `decideBehavior`. It returns structured JSON with visible/runtime actions plus *fast, low-risk* durable state patches — user-profile patches and truth patches only. Keeping reply text inside this call (rather than a separate `decide -> generate` flow) keeps latency and cost down.

Slow, high-impact state — personality signals and all political patches — plus descriptive-snapshot derivation are handled by a separate background state-evolution pass (see [State-Evolution Pass](#state-evolution-pass)). This split keeps the live JSON schema small enough for strict structured output and aligns model escalation with risk. It is a different axis from `decide -> generate` and does not split reply generation.

```ts
interface BehaviorDecision {
  confidence: number;
  actions: BehaviorAction[];
  statePatches: LiveStatePatch[];
  safetyNotes: string[];
}

type BehaviorAction =
  | {
      type: 'reply';
      intent: 'direct_answer' | 'banter' | 'argument' | 'support' | 'correction';
      text: string;
      replyTo: 'trigger' | 'latest' | 'none';
    }
  | {
      type: 'react';
      intent: 'approval' | 'disapproval' | 'mockery' | 'acknowledgement';
      emoji: string;
      targetMessageId: number;
    }
  | {
      type: 'ask_question';
      intent: 'clarify' | 'provoke' | 'invite' | 'challenge';
      text: string;
      targetUsername: string | null;
    }
  | { type: 'summarize_thread'; intent: 'compress_context' | 'state_review'; reason: string };
```

There is no global `mode` for the whole decision. Each action carries its own `type` and `intent`. `type` says what the executor does; `intent` says why or in what style. This allows mixed decisions such as `reply + react + truth.add` or `react + user.add_pattern` without contradictory top-level state. An empty `actions` array is itself a valid and expected outcome: it means "do nothing visible" and is the normal result for messages that pass the gate but warrant no visible response. There is no `stay_silent` action — silence is simply an empty action set. Durable state patches may accompany an empty `actions` array.

For v1, a decision may combine visible actions (for example a `react` plus a `reply`), but at most one of each type per decision: at most one `reply`, one `react`, and one `ask_question`. An empty action set means no visible response. Durable state patches may accompany any combination of actions, including an empty action set, when valid.

`summarize_thread` is an internal runtime action, not a Telegram-visible action, and does not count against the per-type visible-action limits. It does not summarize inline: it only enqueues or bumps the priority of the existing background summarizer (the single owner of summarization), rate-limited and deduplicated against an already-pending or running job. The background summarizer remains the only component that reads history and writes the summary.

Reply target resolution: `replyTo: 'trigger'` replies to the last message in the gate's `triggerMessageIds`; `latest` replies to the most recent message in the batch; `none` sends without a Telegram reply link. A `react` action always targets its explicit `targetMessageId`.

### Context Assembly

The director always loads a bounded recent-history window (a configured number of recent messages) plus the chat summary and current state (personality, political, user profiles, truths). This ambient background is the director's responsibility and does not depend on the gate's selection — it gives `decideBehavior` conversational continuity even if the gate under-selects.

The gate's `triggerMessageIds` and `contextMessageIds` are an overlay on that window, not the sole context source. Trigger messages are marked as what the decision is primarily about (so `replyTo: 'trigger'` and reaction `targetMessageId` resolve against rendered messages); context ids are marked as gate-flagged relevant. A gate-selected id older than the window is fetched and added explicitly. On the direct-trigger path the runtime populates `contextMessageIds` from the flushed batch (see [Gate Batching](#gate-batching)), so both paths share one context contract: recent window + summary + state, with trigger/context ids overlaid.

### State Patch Contract

All durable state changes must go through `statePatches`. Visible/runtime actions do not modify durable memory directly. `remember_truth` is not an action; truth creation, reinforcement, contradiction, and revision are truth patches.

Patch objects use domain-specific discriminated unions, not JSON Patch and not free-form patch descriptions. The AI proposes small semantic changes. Runtime services validate each patch and calculate the final stored state.

```ts
// produced by the live decideBehavior lane
type LiveStatePatch =
  | UserProfilePatch
  | TruthPatch;

// produced by the background state-evolution pass
type EvolutionPatch =
  | PersonalityPatch
  | PoliticalPatch
  | UserPoliticalPatch; // see Political Coordinates

interface PatchEvidence {
  messageIds: number[];
  summary: string;
  confidence: number;
}

type UserProfilePatch =
  | {
      type: 'user.adjust_affinity';
      userId: number;
      delta: -1 | 1;
      evidence: PatchEvidence;
    }
  | {
      type: 'user.add_label';
      userId: number;
      label: string;
      evidence: PatchEvidence;
    }
  | {
      type: 'user.add_pattern';
      userId: number;
      polarity: 'positive' | 'negative' | 'neutral';
      text: string;
      evidence: PatchEvidence;
    }
  | {
      type: 'user.add_grudge';
      userId: number;
      text: string;
      evidence: PatchEvidence;
    }
  | {
      type: 'user.contest_profile_signal';
      userId: number;
      target: {
        kind: 'label' | 'pattern' | 'grudge';
        text: string;
      };
      evidence: PatchEvidence;
    };

type PersonalityPatch = {
  type: 'personality.add_signal';
  area: 'identity' | 'values' | 'speech_style' | 'social_habits' | 'themes';
  polarity: 'reinforce' | 'contest' | 'soften';
  text: string;
  evidence: PatchEvidence;
};

type PoliticalPatch =
  | {
      type: 'politics.add_position';
      topic: string;
      stance: string;
      requestedIntensity: 'weak' | 'moderate' | 'strong' | 'radical';
      evidence: PatchEvidence;
    }
  | {
      type: 'politics.adjust_position';
      positionId: number;
      direction: 'radicalize' | 'soften' | 'contest' | 'reverse';
      evidence: PatchEvidence;
    }
  | {
      type: 'politics.add_uncertainty';
      topic: string;
      summary: string;
      evidence: PatchEvidence;
    };

type TruthPatch =
  | {
      type: 'truth.add';
      text: string;
      relatedTruthIds: number[];
      contradictsTruthIds: number[];
      evidence: PatchEvidence;
    }
  | {
      type: 'truth.reinforce';
      truthId: number;
      evidence: PatchEvidence;
    }
  | {
      type: 'truth.contest';
      truthId: number;
      counterText: string;
      evidence: PatchEvidence;
    }
  | {
      type: 'truth.revise';
      truthId: number;
      revisedText: string;
      evidence: PatchEvidence;
    };
```

The patch set is intentionally restricted:

- no patch may replace an entire state object, array, or arbitrary nested field;
- numeric movement uses bounded deltas or semantic directions, not final values;
- the AI may request `radical` political intensity, but policy may downgrade, move the claim to uncertainty, reject it, or escalate review;
- each patch must carry message evidence and confidence;
- patches in the same decision must be independent. A patch cannot depend on another patch from the same decision creating an ID or changing state first;
- multiple `user.adjust_affinity` patches for the same user in one decision are allowed; the applicator sums their deltas and clamps the result to the [-3, 3] range. Summation is order-independent, so this respects patch independence;
- `user.contest_profile_signal` matches an existing `label` / `pattern` / `grudge` by `text`, attaches its evidence as counter-evidence, and flips the signal `status` to `contested`; when counter-evidence dominates, policy may set `status` to `inactive`. Signals are never deleted. `affinity`, `trust`, and `distance` are not contest targets — affinity moves via `user.adjust_affinity`, and `trust` / `distance` recompute automatically.

Patch application is best-effort per patch. A valid patch may apply even when another patch in the same decision is rejected. Each patch records a result such as `applied`, `rejected`, `ignored`, or `escalated`, with a reason and an optional applied state reference.

`trustLevel` and `preferredDistance` are not direct patch targets in v1. Whenever user profile patches apply, the `StatePatchApplicator` recalculates those derived fields from the updated affinity, labels, patterns, grudges, and evidence history.

The OpenAI integration can initially remain on Chat Completions with structured outputs. Prefer a strict JSON Schema response format for the single `BehaviorDecision` object. Strict function tools are acceptable if they prove easier with the current SDK, but the schema must remain the canonical contract.

### Schema Ownership

Behavior contracts should be authored as Zod schemas. TypeScript types are inferred from those schemas with `z.infer`, runtime validation uses the same schemas with `safeParse`, and the OpenAI JSON Schema is generated from the same source instead of being hand-written separately.

The current project uses Zod v3. For implementation, choose one of these paths:

- update to Zod v4 and use `z.toJSONSchema()`;
- keep Zod v3 and add a maintained Zod-to-JSON-Schema converter.

The implementation should keep schemas simple enough for OpenAI strict structured output: prefer plain objects, enums, arrays, numbers, strings, nullable values, and discriminated unions by `type`. Avoid relying on Zod transforms or complex refinements for behavior that the OpenAI JSON Schema cannot express; enforce those rules in `BehaviorDecisionValidator` and patch policies.

Strict structured output requires every property to be present. Express optional values as required nullable fields (`field: T | null`), never as optional (`field?: T`). The whole contract must follow this rule, including action fields such as `targetUsername` and patch-target fields such as `target.text`.

## State-Evolution Pass

Slow, high-impact state is handled by a separate background AI call — the state-evolution pass — on the `stateEvolution` model slot. It is not latency-bound and runs over a message batch (and may also run periodically), so it can use the stronger model and richer reasoning without slowing the live reply.

Responsibilities:

- **Proposes** `personality.add_signal` patches, all political patches (`politics.add_position`, `politics.adjust_position`, `politics.add_uncertainty`), and the user political-note patches (`user.add_political_note`, `user.contest_political_note`), each with evidence. These never appear in the live `decideBehavior` schema; together they form `EvolutionPatch`.
- **Derives** the descriptive snapshot fields that are not patched per turn: the user-profile `communicationStyle`, `conflictStyle`, `preferredTone`, and `interests`, and the personality `identityNotes`, `values`, `socialHabits`, `recurringThemes`, and `speechStyle` enums (`tone`, `humor`, `verbosity`, `formality`). Derivation reads the accumulated evidence-backed signals plus recent messages and recomputes a coherent snapshot. It never hard-replaces history — the underlying signals remain and stay reversible by later evidence. It also derives the political compasses: `BotPoliticalState.compass` from `positions[]`, and each `UserPoliticalProfile.compass` from that user's active political notes (see Political Coordinates).

`personality.add_signal` is append-only: `reinforce`, `contest`, and `soften` are signal polarities that the pass reconciles when deriving the rendered personality. No patch flips a `speechStyle` enum or edits a specific array element directly.

The pass writes through the same `StatePatchApplicator` and logs to `behavior_events` like the live lane, distinguished by `modelSlot`. The runtime-derived user fields (`trustLevel`, `preferredDistance`) are recomputed deterministically by the applicator whenever user-profile patches apply, independently of this pass.

### Triggering and Cadence

The pass is driven per chat by accumulated evidence, not by a fixed timer alone:

- **Primary trigger — event threshold.** Each chat keeps a high-water mark: the id of the last `behavior_event` the pass processed. The pass runs for a chat when the number of new `behavior_events` since that mark reaches a configured count **and** a configured cooldown has elapsed since the chat's last pass (a cost guard on the stronger `stateEvolution` model).
- **Periodic floor.** A lazy sweep (cron) picks up chats that have pending activity but never reached the event threshold, once they have waited beyond a configured maximum interval, so slow chats still evolve. This is the "may also run periodically" floor, now mandatory rather than optional.

Anchoring on `behavior_events` rather than raw messages means the pass scales with socially meaningful activity (events are exactly what passed the gate), not with chatter noise.

A **single deduplicated worker per chat** owns the pass, following the same pattern as the background summarizer: if a pass for a chat is already pending or running, no second one is enqueued — the running pass picks up everything up to the current high-water mark. This aligns with the future per-chat concurrency key (`chatId`).

The maximum `stateImpactRisk` among the batch's events feeds prioritization: a `high`-risk batch raises the pass's priority (and may lower the effective event threshold) so charged political/personality material is reconciled promptly, and it routes the stronger model to review political and high-impact personality patches before application.

On input the pass reads the delta of new messages/events since the high-water mark **plus** the current rendered state (personality, political, user profiles) so it reconciles signals rather than starting fresh; on completion it advances the high-water mark.

## Model Routing Policy

Do not use the strongest model for every chat turn. Use the cheapest model that can satisfy the task safely, and escalate only when the decision affects durable state, politics, safety, or user-visible quality.

Default v1 routing:

| Workload | Default model | Escalation model | Notes |
| --- | --- | --- | --- |
| Cheap behavior gate (`triggerGate` slot) | `gpt-5.4-nano` or `gpt-5.4-mini` | none | Runs per batch (not per message). It cannot change state or send actions; it only decides whether to call `decideBehavior`. |
| Live `decideBehavior` (`behaviorDecision` slot) | `gpt-5.4-mini` | `gpt-5.5` | Strict structured output. Reply text is generated inside this call for v1. Reactive escalation on schema retry failure, low confidence, conflicting actions, or risky state patches. One proactive rule: a gate `stateImpactRisk` of `high` starts directly on the stronger model, skipping the cheap-first attempt. |
| Summarization (`summarization` slot) | `gpt-5.4-mini` | `gpt-5.5` | Background thread summaries. Escalate only for large context. |
| State-evolution pass (`stateEvolution` slot) | `gpt-5.4-mini` | `gpt-5.5` | Proposes personality and political patches and derives descriptive profile/personality snapshots. Political patches and high-impact personality changes are reviewed by the stronger model before application. |
| AI error repair hints (`errorRepair` slot) | `gpt-5.4-mini` | `gpt-5.5` | Runtime errors can use the cheaper model; repeated or unclear failures can escalate. |
| Offline evals and deep repair | `gpt-5.5` | none | Asynchronous review, evals, or manual repair workflows only; not part of the normal chat path. |

Routing should be explicit configuration, not scattered literals. Replace the current `ask`, `summary`, and `interest` model slots with task-oriented model slots such as `behaviorDecision`, `summarization`, `triggerGate`, `stateEvolution`, and `errorRepair`. All slots target the GPT-5 series; the current `o3` / `o3-mini` configuration is retired. There is no `pro`-tier model in v1.

There is no separate `replyGeneration` model slot in v1. If the visible reply needs a stronger model, the entire `decideBehavior` call escalates so the returned JSON and reply text stay in one contract.

The gate's `stateImpactRisk` is a proactive routing input, but for the live lane only at its top setting: `high` starts `decideBehavior` on the stronger model to avoid a cheap-first-then-redo round-trip on socially charged turns (conflict, attitude toward Carl, argument), where reply quality matters most. `none`, `low`, and `medium` use the cheap model first with reactive escalation. The same `stateImpactRisk` signal independently prioritizes and gates the model of the state-evolution pass (see [Triggering and Cadence](#triggering-and-cadence)); the high-impact political and personality patches it predicts live in that pass, not in the live decision.

Each AI call should log the selected model, reasoning effort where supported, whether escalation happened, the escalation reason, latency, token usage, and the behavior event or error event it belongs to.

For v1, Chat Completions can remain acceptable if structured tool/function arguments are reliable enough. For reasoning-heavy, tool-using, or multi-turn stateful workflows, prefer the Responses API. `gpt-5.5` should be the target top-tier model for those workflows, with `reasoning.effort` tuned per workload instead of always using the default.

## Prompt Structure

New prompt files:

- `neutral_core_prompt.md`: minimal identity, safety, anti-spam, and prompt privacy rules.
- `behavior_decision_system_prompt.md`: how to choose actions and patches.
- `state_evolution_system_prompt.md`: how to propose personality/political patches and derive descriptive snapshots.
- `personality_state_prompt.md`: current chat personality state.
- `political_state_prompt.md`: current political state and uncertainty.
- `user_profiles_prompt.md`: compact per-user social profiles.
- `truths_prompt.md`: known chat truths.

Existing prompts to replace or reduce:

- `persona.md` becomes a neutral core or is replaced by `neutral_core_prompt.md`.
- `check_interest_prompt.md` becomes part of behavior decision.
- `assess_users_prompt.md` becomes structured profile patch guidance.
- `reply_trigger_prompt.md` becomes context inside behavior decision.

Summarization remains as a separate background function.

## Storage

Treat the database as greenfield with a destructive migration: the existing database holds nothing worth preserving, so the migration drops the legacy tables and recreates the full schema from scratch. There is no backfill and no compatibility shim. The recreated schema still includes the operational tables the new system needs — `messages` (the canonical message store that every `evidenceMessageIds` reference resolves against), `users`, `chats`, and `summaries` — alongside the six new tables below. The old `users.attitude` field is simply absent from the new schema; there is no separate "retire later" step.

Per-chat state rows (`bot_personality_states`, `bot_political_states`, `user_social_profiles`) are created lazily on the first relevant event; the absence of a row renders as a neutral blank-slate default, which is exactly how Carl starts neutral everywhere.

Core tables:

```text
bot_personality_states
bot_political_states
bot_truths
user_social_profiles
user_political_profiles
behavior_events
ai_error_events
```

`behavior_events` stores every AI decision, validation result, and applied/ignored action:

```ts
interface BehaviorEvent {
  id: number;
  chatId: number;
  schemaVersion: string;
  gateReason: string | null;
  gateConfidence: number | null;
  gateStateImpactRisk: string | null;
  triggerMessageIdsJson: string;
  contextMessageIdsJson: string;
  modelSlot: string;
  selectedModel: string;
  escalated: boolean;
  escalationReason: string | null;
  actionsJson: string;
  actionResultsJson: string;
  statePatchesJson: string;
  patchResultsJson: string;
  confidence: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
}
```

Use JSON fields in SQLite for nested state in v1. This keeps implementation small and maps cleanly to structured AI output. Both the live `decideBehavior` lane and the background state-evolution pass log to `behavior_events`, distinguished by `modelSlot`; events are anchored by `chatId`, `triggerMessageIdsJson`, and `contextMessageIdsJson` rather than a single message id.

No hard deletes: the database is append-and-flag. No row is ever physically deleted from any table — messages, user signals (labels, patterns, grudges), truths, political positions, personality signals, behavior events, or error events. "Removal" is always a status change (for example a signal becoming `inactive`, a truth becoming `superseded`, a political position becoming `reversed`). This keeps every `evidenceMessageIds` / id reference valid forever and makes the full history inspectable and reversible by later evidence.

Message retention follows the same rule: stored messages must persist because every state object and error log references their ids. If a message must be excluded from context or hidden, mark it inactive with a flag instead of deleting it. All evidence message IDs resolve against the bot's own message store, not against Telegram, so evidence references stay valid even if the original Telegram message is later removed.

## Validation and Runtime Policy

AI output is advisory. Runtime code decides what is applied.

Services:

- `BehaviorDecisionValidator`: validates the Zod schema, enums, confidence, text length, target message IDs, allowed emoji, per-type action limits, and required evidence.
- `PatchPolicy`: validates state patches by domain: personality, political, user profile, and truth.
- `BehaviorRateLimiter`: limits initiative, reactions, and truth creation.
- `BehaviorExecutor`: applies valid visible actions through Telegram and sends valid durable patches to the patch applicator.
- `StatePatchApplicator`: applies accepted patches independently, calculates final state changes, and records per-patch outcomes.
- `BehaviorEventLogger`: records decisions and outcomes.

State patches are applied immediately when they pass validation and policy. Patch application is partial and independent: one rejected patch does not block unrelated valid patches from the same decision. Reversibility is handled by later evidence-backed patches, not by time decay or automatic forgetting.

Fallbacks:

- invalid JSON: record an AI error and produce no visible action (empty action set);
- invalid action: drop only that action;
- invalid state patch: reject only that patch and record the reason;
- weak political patch: move to uncertainty or ignore;
- unsafe hard-boundary content: reject the unsafe visible action or patch;
- rejected Telegram reaction: record error and continue;
- empty or too-long reply: drop reply action;
- OpenAI failure: record error and do not block message storage.

## AI-Agent-Friendly Error Logs

Runtime logs remain in pino, but AI-repair workflows need a separate structured error journal.

```ts
interface AiErrorEvent {
  id: number;
  chatId: number | null;
  source: string;
  severity: 'warning' | 'error' | 'critical';
  errorCode: string;
  message: string;
  component: string;
  operation: string;
  inputRefJson: string | null;
  outputRefJson: string | null;
  stackHash: string | null;
  fixHint: string;
  status: 'open' | 'resolved' | 'ignored';
  createdAt: string;
}
```

Example sources:

- `behavior_decision_parse`
- `behavior_decision_validation`
- `personality_patch_policy`
- `political_patch_policy`
- `telegram_action`
- `openai_request`
- `prompt_building`

The log should avoid secrets and full private dumps. Store message IDs, behavior event IDs, truncated JSON fragments, component names, and precise fix hints.

## Testing Strategy

Unit tests:

- model routing and escalation decisions;
- cheap behavior gate schema validation;
- behavior decision schema validation;
- Zod-to-JSON-Schema generation for the OpenAI structured output contract;
- personality patch policy;
- political patch policy;
- user profile patch application;
- state patch independence and best-effort partial application;
- affinity delta summation and clamping to the [-3, 3] range;
- contest deactivation: signal status moves active -> contested -> inactive without deletion;
- no hard deletes: "removal" is a status flag across user signals, truths, and political positions;
- state-evolution pass derives descriptive profile and personality snapshots from accumulated signals;
- truth creation policy;
- contradictory truth storage and retrieval;
- behavior executor actions: reply, react, ask question, and an empty action set (no visible response);
- AI error log recording.

Prompt/director tests:

- behavior prompt includes neutral core, personality state, political state, truths, user profiles, summary, and recent messages;
- no fixed ideology leaks into a blank-slate chat;
- political state is rendered separately from personality.
- rough private banter mode does not force politeness, while hard-boundary safety rules remain visible in the system prompt.

AI service tests:

- `decideBehavior` sends schema/tool config;
- `decideBehavior` uses the configured default model and escalates to the configured stronger model only when policy requires it;
- valid JSON is parsed;
- invalid JSON creates an AI error event;
- tool/function arguments are parsed and validated.

Integration tests:

- cheap behavior gate skips unimportant messages without state changes or Telegram actions;
- incoming message can produce a reply and behavior event;
- incoming message can produce a reaction without reply;
- incoming message can create or contest a truth through `statePatches` without a visible action;
- repeated evidence can update personality;
- a strong single event can noticeably shift state without fully rewriting it;
- weak political evidence goes to uncertainty instead of updating political positions;
- later evidence can contest or reverse user, personality, truth, or political state;
- invalid Telegram action logs an AI error and does not crash.

## Phasing

### Phase 1: Data and Contracts

Create entities, repositories, Zod schemas, generated JSON Schema wiring, migrations, and validators.

### Phase 2: AI Decision Pipeline

Add the cheap behavior gate, `decideBehavior`, new prompt director flow, and behavior event logging. The cutover is hard: the legacy answer flow is not kept alive in parallel (the greenfield migration removes its data and `users.attitude`), so this phase builds the new pipeline toward replacing it directly.

### Phase 3: Executor and Tools

Implement reply, react, ask question, and summarize thread actions, plus handling of an empty action set (no visible response).

### Phase 4: State Evolution

Add the background state-evolution pass that proposes personality and political patches and derives the descriptive snapshots. Apply truth and user-profile patches from the live lane, and personality/political patches from the evolution pass, immediately after policy checks. Later evidence can reverse them.

### Phase 5: Cut Over to the New Flow

Route normal Telegram handling through the behavior pipeline and remove the legacy `DefaultChatResponder` path. Because the greenfield migration already excludes `users.attitude`, there is no separate attitude-retirement step here.

## Non-Goals for v1

- inline games;
- public profile cards;
- complex polls;
- multi-call `decide -> generate` pipeline;
- time-based decay or automatic forgetting;
- compatibility backfill for old `users.attitude`;
- full migration away from Chat Completions to Responses API;
- per-chat write-concurrency control (chosen approach, when implemented: a single concurrency key = `chatId`, so at most one state-mutating job runs per chat while other chats run in parallel; out of scope for v1).

## Resolved Design Decisions (2026-05-29)

These items were raised in review and resolved in a follow-up brainstorm. Their resolutions are integrated into the sections above; this list is a traceability summary.

- **B1 — Profile field maintenance.** Hybrid: descriptive fields (`communicationStyle`, `conflictStyle`, `preferredTone`, `interests`) are re-derived by the state-evolution pass; event fields stay as `decideBehavior` patches; `trustLevel` / `preferredDistance` are runtime-derived. (See User Social Profiles, State-Evolution Pass.)
- **B2 — Patterns.** The four pattern-ish arrays collapse into one polarity-tagged `patterns: PatternSignal[]`; `user.add_pattern` appends one item; irritation triggers are negative patterns. (See User Social Profiles.)
- **B3 — Contest targets.** `user.contest_profile_signal` targets only `label` / `pattern` / `grudge`, matched by `text`; it attaches counter-evidence and flips `status` (`contested`, then `inactive`), never deletes. `affinity` moves via `adjust_affinity`; `trust` / `distance` recompute. (See State Patch Contract.)
- **B4 — Personality patches.** `personality.add_signal` stays append-only; arrays and `speechStyle` enums are derived by the state-evolution pass; `contest` / `soften` are reconciled there. (See Personality State, State-Evolution Pass.)
- **C2 — Schema split.** The live `decideBehavior` schema carries only `LiveStatePatch` (`UserProfilePatch | TruthPatch`); personality and political patches move to the state-evolution pass (`EvolutionPatch`), keeping each strict schema small. (See Behavior Decision Contract, State-Evolution Pass.)
- **E4 — Event anchor.** `behavior_events.messageId` is dropped; events anchor on `chatId` + `triggerMessageIdsJson` + `contextMessageIdsJson`. (See Storage.)
- **E6 — Summarization.** `summarize_thread` only enqueues the single background summarizer; no inline or competing summarization. (See Behavior Decision Contract.)
- **E7 — Affinity bounds.** `affinityScore` clamps to [-3, 3]; multiple `adjust_affinity` for one user in a decision are summed then clamped. (See State Patch Contract.)

### Second follow-up (2026-05-29): pipeline mechanics

- **F1 — Gate batching.** Non-triggered messages batch per chat; flush on size cap OR hard-cap age OR idle gap (whichever first), all configurable. A direct trigger flushes the open batch into the same `decideBehavior` call's `contextMessageIds`; the batch never spawns its own gate call. (See Gate Batching.)
- **F2 — Evolution cadence.** The state-evolution pass runs per chat on a `behavior_events` high-water threshold + cooldown, with a periodic sweep floor, owned by a single deduplicated worker per chat; `high` gate risk raises priority. (See Triggering and Cadence.)
- **F3 — Greenfield scope.** Destructive migration: drop legacy tables and recreate the full schema (operational tables + six new), no backfill, `users.attitude` absent. Hard cutover — the legacy answer flow is not run in parallel. (See Storage, Phasing.)
- **F4 — Context assembly.** The director always loads a bounded recent-history window + summary + state; gate `triggerMessageIds` / `contextMessageIds` are an overlay marking attention, not the sole context source. (See Context Assembly.)
- **F5 — Risk-based routing.** `stateImpactRisk: 'high'` proactively starts `decideBehavior` on the stronger model; other levels stay cheap-first/reactive. The same signal prioritizes and gates the model of the evolution pass, where the high-impact patches actually live. (See Model Routing Policy, Triggering and Cadence.)

### Third follow-up (2026-05-30): political coordinates

- **G1 — Compass model.** A 2-axis political compass (economic `[-10, 10]`, social `[-10, 10]`) with per-axis confidence `[0, 1]`, per chat, for both the bot and chat users. (See Political Coordinates → Compass Model.)
- **G2 — Bot coordinate.** Derived rollup of the bot's `positions[]` by the state-evolution pass; never patched directly. (See Political Coordinates → Bot Compass.)
- **G3 — User model.** Evidence-backed, append-only political notes drive a derived compass; stored in a new `user_political_profiles` table, separate from `user_social_profiles`. (See Political Coordinates → User Political Profile.)
- **G4 — Derivation lane.** The state-evolution pass owns compass derivation and the user political-note patches (`UserPoliticalPatch`); none of it is in the live `decideBehavior` schema. (See Political Coordinates → Derivation and Patches.)
- **G5 — Behavior use.** Context-only and emergent: coordinates render into prompts; no computed political-distance field and no forced tone bias. (See Political Coordinates → Behavior Influence.)

## Open Design Choices for Implementation Plan

- Whether implementation upgrades to Zod v4 or adds a Zod v3 JSON Schema converter.
- Exact OpenAI structured output syntax: JSON Schema response format or strict function tool.
- Allowed reaction emoji set.
- Initial confidence thresholds for personality and political patches.
- Exact routing thresholds for `gpt-5.5` escalation and whether the first v1 implementation migrates `decideBehavior` to the Responses API immediately or keeps Chat Completions until the behavior pipeline is stable.
