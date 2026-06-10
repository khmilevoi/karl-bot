# Chat Timeline Prompt Design

Date: 2026-06-06
Status: Draft

## Problem

Carl currently sends behavior prompts as a mostly flat transcript of recent chat
messages plus long-lived state. This makes Telegram conversations look like one
linear document instead of a messenger timeline with bursts, pauses, replies,
quotes, and visible bot actions.

The observed failure:

- Users discussed one topic about AI agents and junior developers.
- Later, users shifted into a clown-reaction bit around flat-earth and HIV bait
  messages.
- A user sent `Карл объяснись`.
- Carl replied partly to the older AI workflow topic instead of explaining the
  recent clown reactions.

Database and prompt-log inspection showed the fresh messages were present in the
prompt. The issue was not missing history. The issue was weak structure:

- recent history and background state had similar prompt weight;
- bot reactions were stored as behavior events, but not represented as visible
  chat timeline events;
- message timestamps and time gaps were not available in the model-facing
  context;
- the prompt did not explain how to read messenger context bottom-up;
- explicit replies were not elevated into a dedicated reply-chain context.

## Goals

- Make the model read Telegram context as a chat timeline, not as a flat essay.
- Include successful bot reactions as visible chat events in behavior prompts.
- Preserve only visible chat reality in the model-facing prompt.
- Treat explicit Telegram replies as hard anchors.
- Teach the model to resolve ambiguous short triggers by reading recent chat
  from newest to oldest.
- Add timestamps and large-gap markers so topic changes after pauses are visible.
- Keep all tuning knobs in a dedicated config object.
- Use a hybrid architecture: derive timeline events from current tables in v1,
  while isolating prompt logic behind an event-stream interface that can later
  be backed by a first-class `chat_events` table.

## Non-Goals

- Do not build full topic segmentation in v1.
- Do not expose internal action intent, gate reason, validation errors, or
  failed actions to the model.
- Do not replace behavior state, user profiles, truths, or political state.
- Do not store every event in a new `chat_events` table yet.
- Do not use bot-action events as evidence ids for state patches unless the
  schema is deliberately expanded later.

## Design Decisions

### 1. Hybrid Timeline Source

Use a derived timeline in v1:

- message events come from `messages`;
- bot reaction events come from successful `behavior_events.action_results_json`
  joined with the corresponding `actions_json`;
- bot replies remain normal assistant message events, because they are already
  stored in `messages`;
- failed, dropped, and internal actions stay in `behavior_events` for debugging
  only.

The code should introduce a separate timeline assembly boundary, for example
`ChatTimelineAssembler`, so prompt-building code consumes timeline events rather
than knowing whether they came from `messages`, `behavior_events`, or a future
`chat_events` table.

### 2. Visible Reality Only

The model-facing prompt should include only events visible to chat members:

- user messages;
- assistant messages sent to Telegram;
- successful bot reactions sent to Telegram.

It should not include:

- failed reactions;
- dropped actions;
- validation failures;
- action intent such as `mockery`;
- gate reason such as `ambient_reaction`;
- internal repair or state-evolution details.

Those remain available in logs and database tables for developer diagnostics.

### 3. Reaction Events Are Separate Timeline Events

Telegram reactions are visible bot actions, not hidden metadata. They should be
rendered as their own timeline events, ordered by time:

```text
[msg #75] 2026-06-06 10:41:03Z (+12s after previous) Даниил:
Земля круглая

[event E76] 2026-06-06 10:41:21Z (+18s after #75) Carl reacted 🤡 to msg #75
```

Do not render internal intent:

```text
intent: mockery
reason: ambient_reaction
```

The emoji guide already tells the model how to interpret `🤡`. The timeline only
states what happened in the chat.

### 4. Reply Chain Has Priority

An explicit Telegram reply means the user is writing about that target message.
This is not a weak hint or example-based heuristic. It is the primary anchor for
interpretation.

When the trigger message has `reply_to_message_id`, the prompt should include a
`REPLY_CHAIN` block before the current timeline. The chain should include up to
the configured number of linked messages, newest trigger included, walking
through reply targets where available.

The model rule:

- If `REPLY_CHAIN` is present, interpret the trigger through that chain first.
- Current timeline still provides atmosphere, but must not override the reply
  target.
- Only ignore the reply chain when the trigger text explicitly changes topic.

### 5. Recency-First Bottom-Up Reading

For non-reply ambiguous triggers, the model should resolve intent by reading the
current timeline from newest to oldest.

Examples of ambiguous trigger shapes:

- `Карл объяснись`
- `ты чего`
- `что это было`
- `зачем`
- `ну и?`
- `лол`

These usually refer to the nearest preceding visible bot action or message,
especially a bot reaction or reply.

The prompt should state this as a messenger rule, not as a set of one-off
examples:

```text
For ambiguous short trigger messages, resolve the reference by reading
CURRENT_CHAT_TIMELINE from newest to oldest. In messengers, short follow-ups
usually refer to the nearest previous visible bot action or message.
```

### 6. Current Timeline Window

For v1, use a simple configured window:

- last 15 visible events before the trigger;
- include the trigger event;
- include gap markers for large time gaps;
- do not dynamically segment by topic yet.

This avoids overfitting and keeps the prompt smaller while fixing the observed
class of failures.

### 7. Timestamps And Gaps

Messages should have a model-facing timestamp. Add `sent_at` to `messages` and
populate it for new messages:

- user messages: Telegram message `date` converted to ISO;
- assistant messages: Telegram send result date if available, otherwise the
  local send time;
- existing historical rows: nullable `sent_at`, displayed with an explicit
  fallback marker if unknown.

Reaction events should use `behavior_events.created_at` in v1. If future code
stores action-level timestamps, the timeline assembler can use those instead.

Render both absolute time and relative gap:

```text
[msg #80] 2026-06-06 11:09:40Z (+27m after E79) bobr [TRIGGER]:
Карл объяснись
```

For gaps above the configured threshold, insert a separate marker:

```text
--- 27 minutes later ---
```

Default threshold: 5 minutes.

## Configuration

Add a dedicated config object. Suggested shape:

```ts
export interface BehaviorTimelineConfig {
  currentTimelineLookbackEventLimit: number;
  replyChainMessageLimit: number;
  largeGapMs: number;
  includeVisibleBotActions: boolean;
  includeFailedBotActionsInPrompt: boolean;
}

export const DEFAULT_BEHAVIOR_TIMELINE_CONFIG: BehaviorTimelineConfig = {
  currentTimelineLookbackEventLimit: 15,
  replyChainMessageLimit: 5,
  largeGapMs: 5 * 60_000,
  includeVisibleBotActions: true,
  includeFailedBotActionsInPrompt: false,
};
```

`includeFailedBotActionsInPrompt` should stay false by default and should exist
mainly as a guarded diagnostic switch. It must not be enabled in normal bot
operation.

## Domain Model

Introduce prompt-facing timeline types, separate from persistence rows:

```ts
export type ChatTimelineEvent =
  | ChatTimelineMessageEvent
  | ChatTimelineBotReactionEvent
  | ChatTimelineGapEvent;

export interface ChatTimelineMessageEvent {
  type: 'message';
  messageId: number;
  telegramMessageId: number | null;
  chatId: number;
  role: 'user' | 'assistant';
  userId: number | null;
  username: string | null;
  fullName: string | null;
  content: string;
  sentAt: string | null;
  replyToTelegramMessageId: number | null;
  replyToUserId: number | null;
  sourceType: 'text' | 'voice';
  markers: {
    trigger: boolean;
    gateContext: boolean;
    batch: boolean;
    addressedToSelf: boolean;
  };
}

export interface ChatTimelineBotReactionEvent {
  type: 'bot_reaction';
  eventId: string;
  chatId: number;
  emoji: string;
  targetMessageId: number;
  targetTelegramMessageId: number | null;
  createdAt: string;
}

export interface ChatTimelineGapEvent {
  type: 'gap';
  durationMs: number;
}
```

The exact names can follow repository conventions during implementation. The
important boundary is that prompt rendering consumes these events, not raw
SQLite rows or raw behavior event JSON.

## Data Access

The timeline assembler needs these capabilities:

- get recent ready messages for a chat, ordered by message insertion/time;
- resolve a stored message by `(chatId, telegramMessageId)` for reply-chain
  traversal;
- get recent behavior events for a chat;
- parse successful visible reaction actions from behavior events.

For v1 reaction derivation:

- parse `actions_json` and `action_results_json` in parallel by array index;
- include only entries where:
  - action type is `react`;
  - action result action type is `react`;
  - outcome is `sent`;
  - action has an emoji;
  - result has a target stored message id;
- use behavior event `created_at` as reaction event time;
- resolve target message for display if it is available.

If action/result arrays do not align, skip the event for prompt rendering and
log a diagnostic warning. Do not show uncertain internal data to the model.

## Prompt Structure

Behavior decision prompts should move toward this structure:

```text
CHAT_CONTEXT_GUIDE
<rules for reading Telegram timeline, reply chains, timestamps, and bot actions>

REPLY_CHAIN
<only if trigger is a reply>

CURRENT_CHAT_TIMELINE
<last configured visible events before the trigger, plus the trigger>

BACKGROUND_CONTEXT
<existing summary, personality, politics, profiles, truths, and older history>
```

The current prompt system can implement this by adding a new builder method, for
example `addChatTimeline(...)`, and a new prompt template, for example
`behavior_chat_context_guide_prompt.md`.

The old `addBehaviorMessages(...)` can be retained for gate prompts or gradually
split:

- gate prompts can continue using batches if no timeline is needed;
- behavior decision prompts should use the structured timeline;
- state evolution can continue using broad chronological messages unless it
  benefits from timeline events later.

## Model Instructions

The guide should include these rules in plain language:

```text
You are reading a Telegram chat, not a single article or one continuous essay.
Messages arrive in bursts. People reply to old messages. People ask short
follow-up questions. Bot reactions are visible events in the chat.

Priority for understanding the trigger:
1. If REPLY_CHAIN exists, the trigger is about that reply target/chain.
2. Otherwise, read CURRENT_CHAT_TIMELINE from newest to oldest.
3. Nearest previous visible bot action or bot message is usually the anchor for
   short ambiguous triggers.
4. Use BACKGROUND_CONTEXT only as background memory and personality context.
   Do not import an older topic as the current topic unless the reply chain or
   current timeline points to it.
5. Large time gaps weaken old context unless a reply chain connects it.

Never expose internal ids, schemas, action intents, gate reasons, or diagnostics
in visible replies.
```

## Reference IDs

Avoid confusing message evidence ids with non-message event ids.

- Messages should keep existing `#N` ordinal references because state patch
  schemas use message references.
- Bot-action events should use a distinct prefix such as `E1`, not `#N`.
- Prompt instructions must say that `statePatches[*].evidence.messageIds` may
  use only message `#N` references, never `E*` event ids.

This preserves compatibility with `MessageReferenceMap` and ordinal translation.

## Migration

Add a nullable timestamp column:

```sql
ALTER TABLE messages ADD COLUMN sent_at TEXT;
```

Backfill is optional for historical rows because Telegram timestamps are not
stored today. Existing rows can remain `NULL`. The formatter should handle nulls
explicitly:

```text
[msg #12] time unknown bobr:
...
```

New inserts should set `sent_at`.

## Expected Incident Behavior

For the observed `Карл объяснись` incident, the new prompt would show:

- recent flat-earth/HIV/clown messages;
- successful `🤡` bot reactions as separate visible events;
- the `Карл объяснись` trigger after those events;
- any large gap marker between older AI workflow discussion and current events;
- instructions that short ambiguous triggers should be resolved bottom-up.

The expected answer should explain the recent clown reactions, not revive the
older AI workflow topic unless the user explicitly replied to or mentioned it.

## Testing Strategy

Add focused tests before implementation:

1. Timeline assembler includes successful reaction events.
2. Timeline assembler excludes failed/dropped/internal actions.
3. Reaction event rendering includes emoji and target, not internal intent.
4. Current timeline respects `currentTimelineLookbackEventLimit` and adds the
   trigger separately.
5. Gap markers appear when event delta exceeds `largeGapMs`.
6. Reply-chain assembler follows up to `replyChainMessageLimit`.
7. Prompt rendering places `REPLY_CHAIN` before `CURRENT_CHAT_TIMELINE`.
8. Prompt rendering marks background as lower-priority context.
9. Evidence instructions distinguish message refs from event refs.
10. Regression fixture for the `Карл объяснись` incident verifies the prompt
    contains recent reaction events and bottom-up messenger rules.

## Implementation Notes

- Keep the change scoped to behavior prompt assembly and message persistence.
- Do not refactor behavior state or state patch application unless needed for
  reference-id compatibility.
- Keep failed/dropped action diagnostics in existing `behavior_events`.
- Do not expose prompt-only event ids in visible bot replies.
- The design intentionally prepares for a future `chat_events` table, but v1
  should not require that migration.

## Open Questions For Implementation

- Whether assistant message `sent_at` should come from Telegram response date or
  local `new Date().toISOString()` if the messenger wrapper currently returns
  only `message_id`.
- Whether `recentHistoryLimit` should remain 80 as background or be split into
  `backgroundHistoryLimit` under timeline config.
- Whether gate prompts should stay batch-only or also receive small timeline
  context for better trigger/context id selection.
