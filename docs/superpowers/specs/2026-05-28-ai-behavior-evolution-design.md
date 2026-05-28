# AI Behavior Evolution Design

## Status

Approved through brainstorming on 2026-05-28.

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
  -> trigger/context
  -> AI behavior decision JSON
  -> validation and policy checks
  -> behavior executor
  -> Telegram actions and state patches
  -> behavior/error event logs
```

The AI no longer only writes text. It chooses social actions and proposes state changes. Runtime services validate and apply only safe, evidence-backed changes.

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
  truths: string[];
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

Personality changes through patches, not replacement. A patch needs evidence, confidence, and policy approval. One direct instruction such as "you are now X" must not rewrite the bot.

## Political State

Political beliefs are stored separately from personality.

```ts
interface BotPoliticalState {
  chatId: number;
  ideologySummary: string;
  positions: PoliticalPosition[];
  uncertaintyAreas: string[];
  influenceHistory: PoliticalInfluence[];
  lastUpdatedAt: string;
}

interface PoliticalPosition {
  topic: string;
  stance: string;
  confidence: number;
  evidenceMessageIds: number[];
  origin: 'chat_discussion' | 'bot_reflection' | 'admin_seed';
  updatedAt: string;
}

interface PoliticalInfluence {
  source: 'chat_discussion' | 'bot_reflection' | 'admin_seed';
  summary: string;
  evidenceMessageIds: number[];
  confidence: number;
  createdAt: string;
}
```

Carl starts politically neutral. Positions emerge only from repeated discussion, strong evidence, or explicit admin seeding. Political patches are stricter than normal personality patches: weak claims go to `uncertaintyAreas` instead of becoming beliefs.

## User Social Profiles

Replace the single `users.attitude` string with structured per-chat user profiles.

```ts
interface UserSocialProfile {
  userId: number;
  chatId: number;
  username: string | null;
  affinityScore: -3 | -2 | -1 | 0 | 1 | 2 | 3;
  communicationStyle: string;
  interests: string[];
  conflictStyle: string;
  preferredTone: string;
  trustLevel: 'low' | 'medium' | 'high';
  notablePatterns: string[];
  evidenceMessageIds: number[];
  updatedAt: string;
}
```

Profiles guide tone and personalization. They should describe interaction patterns, not assign irreversible labels.

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
  createdAt: string;
}
```

### Dialogue Initiatives

Carl can occasionally ask a question, invite a specific user into the discussion, or propose a theme. Initiatives must be rate-limited.

### Personalization

Carl adapts response tone, detail level, and social distance based on `UserSocialProfile`, chat personality, and recent context.

## Behavior Decision Contract

For v1, use one main AI call: `decideBehavior`. It returns structured JSON and may include text, actions, and patches. This keeps latency and implementation cost lower than a separate `decide -> generate` flow.

```ts
interface BehaviorDecision {
  mode:
    | 'reply'
    | 'react'
    | 'remember'
    | 'ask_question'
    | 'summarize'
    | 'silent';
  confidence: number;
  actions: BehaviorAction[];
  personalityPatch: PersonalityPatch | null;
  politicalPatch: PoliticalPatch | null;
  userProfilePatches: UserProfilePatch[];
  safetyNotes: string[];
}

type BehaviorAction =
  | { type: 'reply'; text: string; replyTo: 'trigger' | 'latest' | 'none' }
  | { type: 'react'; emoji: string; targetMessageId: number }
  | {
      type: 'remember_truth';
      text: string;
      confidence: number;
      sourceMessageIds: number[];
    }
  | { type: 'ask_question'; text: string; targetUsername?: string }
  | { type: 'summarize_thread'; reason: string }
  | { type: 'stay_silent'; reason: string };
```

The OpenAI integration can initially remain on Chat Completions with function/tool schema and strict JSON arguments. The Responses API can be evaluated later if the project needs richer built-in tools or stateful interactions.

## Prompt Structure

New prompt files:

- `neutral_core_prompt.md`: minimal identity, safety, anti-spam, and prompt privacy rules.
- `behavior_decision_system_prompt.md`: how to choose actions and patches.
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

Treat the new database as greenfield. Compatibility with the old `users.attitude` field is not required for this design.

Core tables:

```text
bot_personality_states
bot_political_states
bot_truths
user_social_profiles
behavior_events
ai_error_events
```

`behavior_events` stores every AI decision and applied/ignored action:

```ts
interface BehaviorEvent {
  id: number;
  chatId: number;
  messageId: number | null;
  decisionMode: string;
  actionsJson: string;
  personalityPatchJson: string | null;
  politicalPatchJson: string | null;
  userProfilePatchesJson: string | null;
  confidence: number;
  createdAt: string;
}
```

Use JSON fields in SQLite for nested state in v1. This keeps implementation small and maps cleanly to structured AI output.

## Validation and Runtime Policy

AI output is advisory. Runtime code decides what is applied.

Services:

- `BehaviorDecisionValidator`: validates schema, enums, confidence, text length, target message IDs, allowed emoji, and required evidence.
- `PatchPolicy`: validates personality and political patches.
- `BehaviorRateLimiter`: limits initiative, reactions, and truth creation.
- `BehaviorExecutor`: applies valid actions through Telegram and repositories.
- `BehaviorEventLogger`: records decisions and outcomes.

Fallbacks:

- invalid JSON: record an AI error and stay silent;
- invalid action: drop only that action;
- weak political patch: move to uncertainty or ignore;
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
  severity: 'debug' | 'info' | 'warning' | 'error' | 'critical';
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

- behavior decision schema validation;
- personality patch policy;
- political patch policy;
- user profile patch application;
- truth creation policy;
- behavior executor actions: reply, react, remember truth, ask question, stay silent;
- AI error log recording.

Prompt/director tests:

- behavior prompt includes neutral core, personality state, political state, truths, user profiles, summary, and recent messages;
- no fixed ideology leaks into a blank-slate chat;
- political state is rendered separately from personality.

AI service tests:

- `decideBehavior` sends schema/tool config;
- valid JSON is parsed;
- invalid JSON creates an AI error event;
- tool/function arguments are parsed and validated.

Integration tests:

- incoming message can produce a reply and behavior event;
- incoming message can produce a reaction without reply;
- repeated evidence can update personality;
- weak political evidence does not update political positions;
- invalid Telegram action logs an AI error and does not crash.

## Phasing

### Phase 1: Data and Contracts

Create entities, repositories, JSON schemas/types, migrations, and validators.

### Phase 2: AI Decision Pipeline

Add `decideBehavior`, new prompt director flow, and behavior event logging. Keep existing answer flow until the new flow is ready.

### Phase 3: Executor and Tools

Implement reply, react, remember truth, ask question, and stay silent actions.

### Phase 4: State Evolution

Apply personality patches, political patches, and user profile patches behind policy checks.

### Phase 5: Replace Old Flow

Route normal Telegram handling through the behavior pipeline. Retire `users.attitude` from AI behavior.

## Non-Goals for v1

- inline games;
- public profile cards;
- complex polls;
- multi-call `decide -> generate` pipeline;
- compatibility backfill for old `users.attitude`;
- full migration away from Chat Completions to Responses API.

## Open Design Choices for Implementation Plan

- Exact JSON schema syntax for OpenAI tool/function calling.
- Allowed reaction emoji set.
- Initial confidence thresholds for personality and political patches.
- Whether admin can seed initial personality or political state.
- Whether behavior events should store rejected actions separately or inside one outcome field.
