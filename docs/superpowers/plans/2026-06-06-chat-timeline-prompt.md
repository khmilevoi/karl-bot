# Chat Timeline Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Carl's behavior decision prompt around a Telegram-style visible chat timeline with timestamps, reply chains, gap markers, and successful bot reactions as visible events.

**Architecture:** Keep gate and state-evolution prompts on the existing `addBehaviorMessages(...)` path, but move behavior decision prompts to a dedicated `ChatTimelineAssembler` boundary plus timeline formatter. The assembler derives v1 timeline events from `messages` and successful `behavior_events` reaction results, while hiding failed/internal actions and preserving `#N` message refs as the only evidence ids. `sent_at` is added to `messages` for new rows; old rows remain nullable and render as `time unknown`.

**Tech Stack:** TypeScript, Node, Inversify, Zod, SQLite migrations, Vitest, grammY, existing prompt template system.

---

## Source Spec

Use this plan with:

- `docs/superpowers/specs/2026-06-06-chat-timeline-prompt-design.md`
- `CLAUDE.md`
- `AGENTS.md`

Important project rules:

- `docs/superpowers/` is local working material. Do not commit files from this directory.
- No `any` or `@ts-` directives.
- Do not explicitly type values as `undefined`; use optional fields or `null`.
- Prefer pattern matching over nested ternaries where it improves clarity.
- Before implementation commits: `pnpm lint:fix`, `pnpm format:fix`, `pnpm type:check`, `pnpm test`, `pnpm build`.

---

## File Structure

### Create

- `migrations/024_add_message_sent_at.up.sql` - nullable `messages.sent_at`.
- `migrations/024_add_message_sent_at.down.sql` - removes `messages.sent_at`.
- `src/application/behavior/ChatTimelineAssembler.ts` - DI interface, prompt-facing timeline types, config input/output contracts.
- `src/application/behavior/DefaultChatTimelineAssembler.ts` - derives message, reply-chain, reaction, and gap events.
- `src/application/prompts/ChatTimelineFormatter.ts` - pure formatter for `REPLY_CHAIN` and `CURRENT_CHAT_TIMELINE`.
- `prompts/behavior_chat_context_guide_prompt.md` - messenger-context reading rules.
- `test/messageSentAtMigration024.test.ts`
- `test/ChatTimelineAssembler.test.ts`
- `test/ChatTimelineFormatter.test.ts`

### Modify

- `src/domain/messages/ChatMessage.ts` - add `sentAt?: string`.
- `src/domain/repositories/MessageRepository.ts` - add `findByChatAndTelegramMessageId(...)`.
- `src/application/interfaces/messages/MessageService.ts` - delegate `findByChatAndTelegramMessageId(...)`.
- `src/application/use-cases/messages/RepositoryMessageService.ts` - delegate the new lookup.
- `src/application/use-cases/messages/MessageFactory.ts` - set `sentAt` from Telegram `ctx.message.date`.
- `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts` - read/write `sent_at`, implement reply-chain lookup.
- `src/domain/repositories/BehaviorEventRepository.ts` - add recent event lookup.
- `src/infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository.ts` - implement recent event lookup.
- `src/application/behavior/BehaviorConfig.ts` - add `BehaviorTimelineConfig`.
- `src/application/behavior/DefaultBehaviorContextAssembler.ts` - inject timeline assembler and return timeline prompt context.
- `src/application/behavior/DefaultBehaviorExecutor.ts` - persist assistant messages with local `sentAt` fallback and reply-target ids.
- `src/application/prompts/PromptTypes.ts` - add `timeline?: ChatTimelinePromptContext`.
- `src/application/prompts/PromptBuilder.ts` - add chat guide, timeline, reply-chain, and background-label builder steps.
- `src/application/prompts/PromptDirector.ts` - wire behavior decision prompt order to guide -> reply chain -> current timeline -> background context.
- `src/application/interfaces/env/EnvService.ts` - add `behaviorChatContextGuide` prompt file key.
- `src/infrastructure/config/DefaultEnvService.ts` - map new prompt template.
- `src/infrastructure/config/TestEnvService.ts` - map new prompt template.
- `src/container/application.ts` - bind timeline config and assembler.
- Existing tests: `test/sqliteRepositories.test.ts`, `test/SQLiteMessageRepository.reply.test.ts`, `test/MessageFactory.test.ts`, `test/MainService.test.ts`, `test/TelegramVoiceRouting.test.ts`, `test/BehaviorEventLogger.test.ts`, `test/behaviorEventRepositories.test.ts`, `test/BehaviorContextAssembler.test.ts`, `test/PromptDirector.test.ts`, `test/PromptBuilderBehaviorMessages.test.ts`, `test/DefaultBehaviorAiService.behavior.test.ts`, `test/container.behavior.test.ts`.

---

## Compatibility Decisions

- Assistant `sentAt`: use `new Date().toISOString()` inside `DefaultBehaviorExecutor.persistAssistant`. The current `ChatMessenger.sendMessage(...)` returns only Telegram `message_id`; changing the messenger contract would touch many unrelated flows. This is the spec's allowed fallback.
- User and voice `sentAt`: use Telegram `ctx.message.date` when present. It is Unix seconds, so convert with `new Date(date * 1000).toISOString()`.
- Gate prompt: keep existing `addBehaviorMessages(...)`. The gate only needs batch context and should stay small.
- State evolution prompt: keep existing broad chronological messages for now.
- Decision prompt: use new `CHAT_CONTEXT_GUIDE`, optional `REPLY_CHAIN`, `CURRENT_CHAT_TIMELINE`, then `BACKGROUND_CONTEXT`.
- User ids: timeline message headers keep `[userId:N]` because current live user-profile patch schemas require model-emitted `userId`. The guide must explicitly say `userId` is for state patches only and must never be copied into visible replies.
- Bot reaction event ids: render as `E<behaviorEventId>.<actionIndex>`. These are prompt-only visible-event refs, never valid evidence ids.

---

## Task 1: Add `messages.sent_at` Migration

**Files:**
- Create: `migrations/024_add_message_sent_at.up.sql`
- Create: `migrations/024_add_message_sent_at.down.sql`
- Test: `test/messageSentAtMigration024.test.ts`

- [ ] **Step 1: Write the failing migration test**

Create `test/messageSentAtMigration024.test.ts`:

```ts
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('migration 024 message sent_at', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('adds nullable sent_at to messages', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sent-at-migration-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const columns = await db.all<{ name: string; notnull: number }[]>(
      'PRAGMA table_info(messages)'
    );
    await db.close();

    const sentAt = columns.find((column) => column.name === 'sent_at');
    expect(sentAt).toEqual(expect.objectContaining({ notnull: 0 }));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm test -- test/messageSentAtMigration024.test.ts`

Expected: FAIL because `sent_at` is not present.

- [ ] **Step 3: Add migration SQL**

`migrations/024_add_message_sent_at.up.sql`:

```sql
ALTER TABLE messages ADD COLUMN sent_at TEXT;
```

`migrations/024_add_message_sent_at.down.sql`:

```sql
ALTER TABLE messages DROP COLUMN sent_at;
```

- [ ] **Step 4: Run the migration test**

Run: `pnpm test -- test/messageSentAtMigration024.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/024_add_message_sent_at.up.sql migrations/024_add_message_sent_at.down.sql test/messageSentAtMigration024.test.ts
git commit -m "feat(db): add nullable sent_at to messages"
```

---

## Task 2: Persist And Read `sentAt`

**Files:**
- Modify: `src/domain/messages/ChatMessage.ts`
- Modify: `src/domain/repositories/MessageRepository.ts`
- Modify: `src/application/interfaces/messages/MessageService.ts`
- Modify: `src/application/use-cases/messages/RepositoryMessageService.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts`
- Modify: `test/sqliteRepositories.test.ts`
- Modify: `test/SQLiteMessageRepository.reply.test.ts`

- [ ] **Step 1: Write failing repository expectations**

In the manual `CREATE TABLE messages` block in `test/sqliteRepositories.test.ts`, add:

```sql
sent_at TEXT,
```

In `test/sqliteRepositories.test.ts`, add `sentAt` to the first insert and retrieval assertion:

```ts
const firstSentAt = '2026-06-06T10:41:03.000Z';
const firstId = await messageRepo.insert({
  chatId: 1,
  role: 'user',
  content: 'hi',
  userId: 1,
  messageId: 11,
  sentAt: firstSentAt,
});
```

Expected object should include:

```ts
sentAt: firstSentAt,
```

In `test/SQLiteMessageRepository.reply.test.ts`, extend the inserted message:

```ts
sentAt: '2026-06-06T10:41:03.000Z',
```

and assert:

```ts
expect(msg.sentAt).toBe('2026-06-06T10:41:03.000Z');
```

- [ ] **Step 2: Run repository tests and verify failure**

Run: `pnpm test -- test/sqliteRepositories.test.ts test/SQLiteMessageRepository.reply.test.ts`

Expected: FAIL because `sentAt` is not mapped.

- [ ] **Step 3: Add domain field**

In `src/domain/messages/ChatMessage.ts`, add:

```ts
  sentAt?: string;
```

Place it near `messageId?: number;` because both are Telegram message metadata.

- [ ] **Step 4: Extend repository lookup contract**

In `src/domain/repositories/MessageRepository.ts`, add:

```ts
  findByChatAndTelegramMessageId(
    chatId: number,
    telegramMessageId: number
  ): Promise<StoredMessage | null>;
```

In `src/application/interfaces/messages/MessageService.ts`, add the same method.

In `RepositoryMessageService`, implement:

```ts
  async findByChatAndTelegramMessageId(
    chatId: number,
    telegramMessageId: number
  ): Promise<StoredMessage | null> {
    this.logger.debug(
      { chatId, telegramMessageId },
      'Fetching message by chat and Telegram message id'
    );
    return this.messageRepo.findByChatAndTelegramMessageId(
      chatId,
      telegramMessageId
    );
  }
```

- [ ] **Step 5: Map `sent_at` in SQLite repository**

In `SQLiteMessageRepository.ts`:

`MessageRow`:

```ts
  sent_at: string | null;
```

`SELECT_MESSAGE_COLUMNS` should include `m.sent_at` after `m.message_id`:

```ts
export const SELECT_MESSAGE_COLUMNS =
  'SELECT m.id, m.role, m.content, u.username, u.first_name, u.last_name, m.reply_text, m.reply_username, m.quote_text, m.reply_to_message_id, m.reply_to_user_id, m.user_id, c.chat_id, m.message_id, m.sent_at, m.source_type, m.processing_status FROM messages m LEFT JOIN users u ON m.user_id = u.id LEFT JOIN chats c ON m.chat_id = c.chat_id';
```

`rowToMessage`:

```ts
  if (r.sent_at) entry.sentAt = r.sent_at;
```

`insert` destructuring:

```ts
    sentAt,
    sourceType,
    processingStatus,
```

`INSERT` SQL:

```ts
      'INSERT INTO messages (chat_id, message_id, role, content, user_id, reply_text, reply_username, quote_text, reply_to_message_id, reply_to_user_id, sent_at, source_type, processing_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
```

Add the value before `sourceType`:

```ts
      sentAt ?? null,
```

- [ ] **Step 6: Implement reply-chain lookup**

Add to `SQLiteMessageRepository`:

```ts
  async findByChatAndTelegramMessageId(
    chatId: number,
    telegramMessageId: number
  ): Promise<StoredMessage | null> {
    const db = await this.dbProvider.get();
    const row = await db.get<MessageRow>(
      `${SELECT_MESSAGE_COLUMNS} WHERE m.chat_id = ? AND m.message_id = ? AND m.is_active = 1 AND m.processing_status = 'ready'`,
      chatId,
      telegramMessageId
    );
    return row != null ? rowToMessage(row) : null;
  }
```

- [ ] **Step 7: Run tests**

Run: `pnpm test -- test/sqliteRepositories.test.ts test/SQLiteMessageRepository.reply.test.ts test/RepositoryMessageService.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain/messages/ChatMessage.ts src/domain/repositories/MessageRepository.ts src/application/interfaces/messages/MessageService.ts src/application/use-cases/messages/RepositoryMessageService.ts src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts test/sqliteRepositories.test.ts test/SQLiteMessageRepository.reply.test.ts
git commit -m "feat(messages): persist sentAt and lookup Telegram reply targets"
```

---

## Task 3: Capture `sentAt` For User, Voice, And Assistant Messages

**Files:**
- Modify: `src/application/use-cases/messages/MessageFactory.ts`
- Modify: `src/application/behavior/DefaultBehaviorExecutor.ts`
- Modify: `test/MessageFactory.test.ts`
- Modify: `test/MainService.test.ts`
- Modify: `test/TelegramVoiceRouting.test.ts`
- Modify: `test/DefaultBehaviorExecutor.test.ts`

- [ ] **Step 1: Add factory tests for Telegram date conversion**

In `test/MessageFactory.test.ts`, add:

```ts
it('fromUser converts Telegram date seconds to sentAt ISO', () => {
  const ctx = {
    message: { text: 'привет', message_id: 10, date: 1780742463 },
    from: { id: 7, first_name: 'Олег' },
    chat: { id: -100 },
  } as unknown as Context;
  const meta = { username: 'oleg', fullName: 'Олег' } as MessageContext;

  const stored = MessageFactory.fromUser(ctx, meta);

  expect(stored.sentAt).toBe('2026-06-06T10:41:03.000Z');
});

it('fromUserContent converts Telegram date seconds to sentAt ISO', () => {
  const ctx = {
    message: { message_id: 11, date: 1780742481 },
    from: { id: 7, first_name: 'Олег' },
    chat: { id: -100 },
  } as unknown as Context;
  const meta = { username: 'oleg', fullName: 'Олег' } as MessageContext;

  const stored = MessageFactory.fromUserContent(ctx, meta, 'voice text', 'voice');

  expect(stored.sentAt).toBe('2026-06-06T10:41:21.000Z');
});
```

- [ ] **Step 2: Run factory tests and verify failure**

Run: `pnpm test -- test/MessageFactory.test.ts -t "sentAt ISO"`

Expected: FAIL because `sentAt` is missing.

- [ ] **Step 3: Implement date conversion in `MessageFactory`**

Add helper inside `MessageFactory`:

```ts
  private static sentAtFromContext(ctx: Context): string | undefined {
    const date = ctx.message?.date;
    return typeof date === 'number'
      ? new Date(date * 1000).toISOString()
      : undefined;
  }
```

Add to both `fromUser(...)` and `fromUserContent(...)` return objects:

```ts
      sentAt: MessageFactory.sentAtFromContext(ctx),
```

- [ ] **Step 4: Update MainService/voice tests**

In `makeTextCtx(...)` in `test/MainService.test.ts`, include `date: 1780742463`.

In the approved-message assertion, add:

```ts
sentAt: '2026-06-06T10:41:03.000Z',
```

In `makeVoiceCtx(...)` in `test/TelegramVoiceRouting.test.ts`, include `date: 1780742481` in `message`.

In voice storage assertion, add:

```ts
sentAt: '2026-06-06T10:41:21.000Z',
```

- [ ] **Step 5: Test assistant persistence timestamp and reply target ids**

In `test/DefaultBehaviorExecutor.test.ts`, add a test around `reply` action persistence. Use fake timers:

```ts
it('persists assistant replies with sentAt and reply target ids', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-06T10:42:00.000Z'));
  const addMessage = vi.fn().mockResolvedValue(99);
  const messages: MessageService = {
    addMessage,
  } as unknown as MessageService;
  const messenger: ChatMessenger = {
    sendMessage: vi.fn().mockResolvedValue(700),
    bot: { botInfo: { id: 42, username: 'assistant_bot' } },
  } as unknown as ChatMessenger;
  const executor = new DefaultBehaviorExecutor(
    messenger,
    rateLimiter,
    summarizationQueue,
    messages,
    loggerFactory
  );
  const context: BehaviorDecisionContext = {
    ...makeContext(),
    messages: [
      {
        id: 10,
        chatId: -100,
        role: 'user',
        content: 'Карл?',
        userId: 7,
        username: 'oleg',
        messageId: 500,
      },
    ],
    triggerMessageIds: [10],
    batchMessageIds: [10],
  };

  await executor.execute({
    context,
    actions: [
      {
        type: 'reply',
        intent: 'direct_answer',
        text: 'да',
        target: {
          kind: 'message',
          selector: { scope: 'trigger', pick: 'latest', index: null },
        },
      },
    ],
  });

  expect(addMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      role: 'assistant',
      content: 'да',
      messageId: 700,
      sentAt: '2026-06-06T10:42:00.000Z',
      replyToMessageId: 500,
      replyToUserId: 7,
    })
  );
  vi.useRealTimers();
});
```

Use the existing helper style in `test/DefaultBehaviorExecutor.test.ts`; do not introduce shared mutable test globals.

- [ ] **Step 6: Implement assistant persistence**

In `DefaultBehaviorExecutor.persistAssistant(...)`, add to `messages.addMessage(...)`:

```ts
        sentAt: new Date().toISOString(),
        replyToMessageId: repliedTo?.messageId,
        replyToUserId: repliedTo?.userId,
```

- [ ] **Step 7: Run focused tests**

Run: `pnpm test -- test/MessageFactory.test.ts test/MainService.test.ts test/TelegramVoiceRouting.test.ts test/DefaultBehaviorExecutor.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/application/use-cases/messages/MessageFactory.ts src/application/behavior/DefaultBehaviorExecutor.ts test/MessageFactory.test.ts test/MainService.test.ts test/TelegramVoiceRouting.test.ts test/DefaultBehaviorExecutor.test.ts
git commit -m "feat(messages): capture sentAt for Telegram and assistant messages"
```

---

## Task 4: Add Timeline Config And DI Binding

**Files:**
- Modify: `src/application/behavior/BehaviorConfig.ts`
- Modify: `src/container/application.ts`
- Modify: `test/BehaviorConfig.test.ts`
- Modify: `test/container.behavior.test.ts`

- [ ] **Step 1: Write failing config tests**

In `test/BehaviorConfig.test.ts`, add:

```ts
import { DEFAULT_BEHAVIOR_TIMELINE_CONFIG } from '../src/application/behavior/BehaviorConfig';

it('has default behavior timeline config', () => {
  expect(DEFAULT_BEHAVIOR_TIMELINE_CONFIG).toEqual({
    currentTimelineLookbackEventLimit: 15,
    replyChainMessageLimit: 5,
    largeGapMs: 5 * 60_000,
    includeVisibleBotActions: true,
    includeFailedBotActionsInPrompt: false,
  });
});
```

In `test/container.behavior.test.ts`, add a resolution test after the binding exists:

```ts
import {
  BEHAVIOR_TIMELINE_CONFIG_ID,
  type BehaviorTimelineConfig,
} from '../src/application/behavior/BehaviorConfig';

it('resolves behavior timeline config', () => {
  const config = container.get<BehaviorTimelineConfig>(
    BEHAVIOR_TIMELINE_CONFIG_ID
  );
  expect(config.currentTimelineLookbackEventLimit).toBe(15);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- test/BehaviorConfig.test.ts test/container.behavior.test.ts -t "timeline config"`

Expected: FAIL because config does not exist.

- [ ] **Step 3: Add config**

In `BehaviorConfig.ts`, add:

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

export const BEHAVIOR_TIMELINE_CONFIG_ID = Symbol.for(
  'BehaviorTimelineConfig'
) as ServiceIdentifier<BehaviorTimelineConfig>;
```

- [ ] **Step 4: Bind config**

In `src/container/application.ts`, import the new config exports and bind:

```ts
  container
    .bind<BehaviorTimelineConfig>(BEHAVIOR_TIMELINE_CONFIG_ID)
    .toConstantValue(DEFAULT_BEHAVIOR_TIMELINE_CONFIG);
```

Place it near the other behavior config bindings.

- [ ] **Step 5: Run focused tests**

Run: `pnpm test -- test/BehaviorConfig.test.ts test/container.behavior.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/application/behavior/BehaviorConfig.ts src/container/application.ts test/BehaviorConfig.test.ts test/container.behavior.test.ts
git commit -m "feat(behavior): add timeline prompt config"
```

---

## Task 5: Add Recent Behavior Event Lookup

**Files:**
- Modify: `src/domain/repositories/BehaviorEventRepository.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository.ts`
- Modify: `test/behaviorEventRepositories.test.ts`

- [ ] **Step 1: Write failing repository test**

In `test/behaviorEventRepositories.test.ts`, add:

```ts
it('findRecentByChatId returns newest events in chronological order', async () => {
  const mkEvent = (slot: string, createdAt: string) => ({
    chatId: 1,
    schemaVersion: 'v1',
    gateReason: null,
    gateConfidence: null,
    gateStateImpactRisk: null,
    triggerMessageIdsJson: '[]',
    contextMessageIdsJson: '[]',
    modelSlot: slot,
    selectedModel: 'gpt-5.4-mini',
    escalated: false,
    escalationReason: null,
    actionsJson: '[]',
    actionResultsJson: '[]',
    statePatchesJson: '[]',
    patchResultsJson: '[]',
    confidence: 0.5,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    latencyMs: null,
    createdAt,
  });

  await behaviorRepo.insert(mkEvent('behaviorDecision', '2026-06-06T10:00:00.000Z'));
  const id2 = await behaviorRepo.insert(
    mkEvent('behaviorDecision', '2026-06-06T10:01:00.000Z')
  );
  const id3 = await behaviorRepo.insert(
    mkEvent('behaviorDecision', '2026-06-06T10:02:00.000Z')
  );

  const recent = await behaviorRepo.findRecentByChatId(1, 2);

  expect(recent.map((event) => event.id)).toEqual([id2, id3]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- test/behaviorEventRepositories.test.ts -t "findRecentByChatId"`

Expected: FAIL because method does not exist.

- [ ] **Step 3: Add interface method**

In `BehaviorEventRepository`:

```ts
  findRecentByChatId(chatId: number, limit: number): Promise<BehaviorEventEntity[]>;
```

- [ ] **Step 4: Implement SQLite method**

In `SQLiteBehaviorEventRepository`:

```ts
  async findRecentByChatId(
    chatId: number,
    limit: number
  ): Promise<BehaviorEventEntity[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<BehaviorEventRow>(
      `SELECT * FROM (
        SELECT * FROM behavior_events
        WHERE chat_id = ?
        ORDER BY id DESC
        LIMIT ?
      ) ORDER BY id ASC`,
      chatId,
      limit
    );
    return rows.map(toEntity);
  }
```

- [ ] **Step 5: Update mocks**

Update `BehaviorEventRepository` mocks in tests that construct partial repositories, especially `test/BehaviorEventLogger.test.ts`, with `findRecentByChatId: vi.fn()` when needed.

- [ ] **Step 6: Run tests**

Run: `pnpm test -- test/behaviorEventRepositories.test.ts test/BehaviorEventLogger.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/repositories/BehaviorEventRepository.ts src/infrastructure/persistence/sqlite/SQLiteBehaviorEventRepository.ts test/behaviorEventRepositories.test.ts test/BehaviorEventLogger.test.ts
git commit -m "feat(behavior): query recent behavior events for timeline"
```

---

## Task 6: Introduce Timeline Types And Reaction Extraction

**Files:**
- Create: `src/application/behavior/ChatTimelineAssembler.ts`
- Create: `src/application/behavior/DefaultChatTimelineAssembler.ts`
- Modify: `src/container/application.ts`
- Test: `test/ChatTimelineAssembler.test.ts`

- [ ] **Step 1: Create failing tests for successful/failed reaction extraction**

Create `test/ChatTimelineAssembler.test.ts` with these first cases:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BEHAVIOR_TIMELINE_CONFIG,
  type BehaviorTimelineConfig,
} from '../src/application/behavior/BehaviorConfig';
import { DefaultChatTimelineAssembler } from '../src/application/behavior/DefaultChatTimelineAssembler';
import type { BehaviorEventRepository } from '../src/domain/repositories/BehaviorEventRepository';
import type { MessageService } from '../src/application/interfaces/messages/MessageService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { StoredBehaviorMessage } from '../src/application/behavior/BehaviorTypes';

const loggerFactory: LoggerFactory = {
  create: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
} as unknown as LoggerFactory;

function message(overrides: Partial<StoredBehaviorMessage>): StoredBehaviorMessage {
  return {
    id: 1,
    chatId: -100,
    role: 'user',
    content: 'hello',
    userId: 7,
    username: 'oleg',
    messageId: 500,
    sentAt: '2026-06-06T10:41:03.000Z',
    ...overrides,
  };
}

function makeAssembler(params: {
  events?: Awaited<ReturnType<BehaviorEventRepository['findRecentByChatId']>>;
  messages?: Partial<MessageService>;
  config?: Partial<BehaviorTimelineConfig>;
}) {
  const behaviorEvents: BehaviorEventRepository = {
    findRecentByChatId: vi.fn().mockResolvedValue(params.events ?? []),
  } as unknown as BehaviorEventRepository;
  const messages: MessageService = {
    getMessagesByIds: vi.fn().mockResolvedValue([]),
    findByChatAndTelegramMessageId: vi.fn().mockResolvedValue(null),
    ...params.messages,
  } as unknown as MessageService;
  const assembler = new DefaultChatTimelineAssembler(
    { ...DEFAULT_BEHAVIOR_TIMELINE_CONFIG, ...params.config },
    behaviorEvents,
    messages,
    loggerFactory
  );
  return { assembler, behaviorEvents, messages };
}

function makeSentReactionBehaviorEvent(params: {
  id: number;
  targetStoredId: number;
  targetTelegramId?: number;
  emoji?: string;
  createdAt?: string;
}) {
  const emoji = params.emoji ?? '🤡';
  const targetTelegramId = params.targetTelegramId ?? 900;
  return {
    id: params.id,
    chatId: -100,
    schemaVersion: 'behavior.v1',
    gateReason: 'ambient_reaction',
    gateConfidence: 0.9,
    gateStateImpactRisk: 'low',
    triggerMessageIdsJson: JSON.stringify([params.targetStoredId]),
    contextMessageIdsJson: '[]',
    modelSlot: 'behaviorDecision',
    selectedModel: 'gpt-5.4-mini',
    escalated: false,
    escalationReason: null,
    actionsJson: JSON.stringify([
      {
        type: 'react',
        intent: 'mockery',
        emoji,
        target: { scope: 'trigger', pick: 'latest', index: null },
      },
    ]),
    actionResultsJson: JSON.stringify([
      {
        actionType: 'react',
        outcome: 'sent',
        reason: null,
        targetMessageId: params.targetStoredId,
        telegramMessageId: targetTelegramId,
      },
    ]),
    statePatchesJson: '[]',
    patchResultsJson: '[]',
    confidence: 0.8,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    latencyMs: null,
    createdAt: params.createdAt ?? '2026-06-06T10:41:21.000Z',
  };
}

describe('DefaultChatTimelineAssembler', () => {
  it('includes successful visible reaction events', async () => {
    const target = message({ id: 75, messageId: 900, content: 'Земля круглая' });
    const { assembler } = makeAssembler({
      events: [
        {
          id: 76,
          chatId: -100,
          schemaVersion: 'behavior.v1',
          gateReason: 'ambient_reaction',
          gateConfidence: 0.9,
          gateStateImpactRisk: 'low',
          triggerMessageIdsJson: '[75]',
          contextMessageIdsJson: '[]',
          modelSlot: 'behaviorDecision',
          selectedModel: 'gpt-5.4-mini',
          escalated: false,
          escalationReason: null,
          actionsJson: JSON.stringify([
            {
              type: 'react',
              intent: 'mockery',
              emoji: '🤡',
              target: { scope: 'trigger', pick: 'latest', index: null },
            },
          ]),
          actionResultsJson: JSON.stringify([
            {
              actionType: 'react',
              outcome: 'sent',
              reason: null,
              targetMessageId: 75,
              telegramMessageId: 900,
            },
          ]),
          statePatchesJson: '[]',
          patchResultsJson: '[]',
          confidence: 0.8,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          latencyMs: null,
          createdAt: '2026-06-06T10:41:21.000Z',
        },
      ],
    });

    const result = await assembler.assemble({
      chatId: -100,
      messages: [target],
      triggerMessageIds: [75],
      contextMessageIds: [],
      batchMessageIds: [],
    });

    expect(result.promptContext.currentTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'bot_reaction',
          eventId: 'E76.1',
          emoji: '🤡',
          targetStoredMessageId: 75,
          createdAt: '2026-06-06T10:41:21.000Z',
        }),
      ])
    );
  });

  it('excludes failed, dropped, and non-react action results', async () => {
    const target = message({ id: 75, messageId: 900 });
    const { assembler } = makeAssembler({
      events: [
        {
          id: 77,
          chatId: -100,
          schemaVersion: 'behavior.v1',
          gateReason: 'ambient_reaction',
          gateConfidence: 0.9,
          gateStateImpactRisk: 'low',
          triggerMessageIdsJson: '[75]',
          contextMessageIdsJson: '[]',
          modelSlot: 'behaviorDecision',
          selectedModel: 'gpt-5.4-mini',
          escalated: false,
          escalationReason: null,
          actionsJson: JSON.stringify([
            { type: 'react', intent: 'mockery', emoji: '🤡', target: { scope: 'trigger', pick: 'latest', index: null } },
            { type: 'reply', intent: 'banter', text: 'no', target: { kind: 'none' } },
          ]),
          actionResultsJson: JSON.stringify([
            { actionType: 'react', outcome: 'failed', reason: 'telegram error', targetMessageId: 75, telegramMessageId: 900 },
            { actionType: 'reply', outcome: 'sent', reason: null, telegramMessageId: 901 },
          ]),
          statePatchesJson: '[]',
          patchResultsJson: '[]',
          confidence: 0.8,
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          latencyMs: null,
          createdAt: '2026-06-06T10:41:21.000Z',
        },
      ],
    });

    const result = await assembler.assemble({
      chatId: -100,
      messages: [target],
      triggerMessageIds: [75],
      contextMessageIds: [],
      batchMessageIds: [],
    });

    expect(result.promptContext.currentTimeline).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'bot_reaction' })])
    );
  });
});
```

Use formatter-friendly event names in expectations; do not assert whole arrays except where ordering matters.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test -- test/ChatTimelineAssembler.test.ts -t "reaction"`

Expected: FAIL because assembler does not exist.

- [ ] **Step 3: Add timeline interface and types**

Create `src/application/behavior/ChatTimelineAssembler.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

import type { StoredBehaviorMessage } from './BehaviorTypes';

export interface ChatTimelineMessageMarkers {
  trigger: boolean;
  gateContext: boolean;
  batch: boolean;
  addressedToSelf: boolean;
}

export interface ChatTimelineMessageEvent {
  type: 'message';
  storedMessageId: number;
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
  replyUsername: string | null;
  replyText: string | null;
  sourceType: 'text' | 'voice';
  markers: ChatTimelineMessageMarkers;
}

export interface ChatTimelineBotReactionEvent {
  type: 'bot_reaction';
  eventId: string;
  chatId: number;
  emoji: string;
  targetStoredMessageId: number;
  targetTelegramMessageId: number | null;
  createdAt: string;
}

export interface ChatTimelineGapEvent {
  type: 'gap';
  durationMs: number;
}

export type ChatTimelineEvent =
  | ChatTimelineMessageEvent
  | ChatTimelineBotReactionEvent
  | ChatTimelineGapEvent;

export interface ChatTimelinePromptContext {
  replyChain: ChatTimelineMessageEvent[];
  currentTimeline: ChatTimelineEvent[];
}

export interface ChatTimelineAssembly {
  messages: StoredBehaviorMessage[];
  promptContext: ChatTimelinePromptContext;
}

export interface ChatTimelineAssemblerInput {
  chatId: number;
  messages: StoredBehaviorMessage[];
  triggerMessageIds: readonly number[];
  contextMessageIds: readonly number[];
  batchMessageIds: readonly number[];
}

export interface ChatTimelineAssembler {
  assemble(input: ChatTimelineAssemblerInput): Promise<ChatTimelineAssembly>;
}

export const CHAT_TIMELINE_ASSEMBLER_ID = Symbol.for(
  'ChatTimelineAssembler'
) as ServiceIdentifier<ChatTimelineAssembler>;
```

- [ ] **Step 4: Implement first version of `DefaultChatTimelineAssembler`**

Create `DefaultChatTimelineAssembler` with injected:

- `BEHAVIOR_TIMELINE_CONFIG_ID`
- `BEHAVIOR_EVENT_REPOSITORY_ID`
- `MESSAGE_SERVICE_ID`
- `LOGGER_FACTORY_ID`

Initial responsibilities for this task:

- Convert input messages to message events.
- Fetch `behaviorEvents.findRecentByChatId(chatId, config.currentTimelineLookbackEventLimit * 4)`.
- Parse `actionsJson` and `actionResultsJson` by array index.
- Include only `action.type === 'react'`, result `actionType === 'react'`, result `outcome === 'sent'`, non-empty `action.emoji`, non-null result `targetMessageId`.
- Skip mismatched JSON or array lengths and `logger.warn(...)`.
- Return `{ messages: input.messages, promptContext: { replyChain: [], currentTimeline: events } }`.

Representative private helpers:

```ts
  private parseJsonArray(text: string): unknown[] | null {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private toReactionEvents(event: BehaviorEventEntity): ChatTimelineBotReactionEvent[] {
    const actions = this.parseJsonArray(event.actionsJson);
    const results = this.parseJsonArray(event.actionResultsJson);
    if (actions == null || results == null || actions.length !== results.length) {
      this.logger.warn({ behaviorEventId: event.id }, 'Skipping malformed behavior event actions for chat timeline');
      return [];
    }

    const visible: ChatTimelineBotReactionEvent[] = [];
    for (const [index, action] of actions.entries()) {
      const result = results[index];
      if (!this.isSentReaction(action, result)) continue;
      visible.push({
        type: 'bot_reaction',
        eventId: `E${event.id}.${index + 1}`,
        chatId: event.chatId,
        emoji: action.emoji,
        targetStoredMessageId: result.targetMessageId,
        targetTelegramMessageId: result.telegramMessageId ?? null,
        createdAt: event.createdAt,
      });
    }
    return visible;
  }
```

Use type guards with `Record<string, unknown>` checks; do not use `any`.

- [ ] **Step 5: Bind assembler**

In `src/container/application.ts`, import and bind:

```ts
  container
    .bind<ChatTimelineAssembler>(CHAT_TIMELINE_ASSEMBLER_ID)
    .to(DefaultChatTimelineAssembler)
    .inSingletonScope();
```

- [ ] **Step 6: Run focused tests**

Run: `pnpm test -- test/ChatTimelineAssembler.test.ts test/container.behavior.test.ts`

Expected: PASS for reaction extraction and DI.

- [ ] **Step 7: Commit**

```bash
git add src/application/behavior/ChatTimelineAssembler.ts src/application/behavior/DefaultChatTimelineAssembler.ts src/container/application.ts test/ChatTimelineAssembler.test.ts test/container.behavior.test.ts
git commit -m "feat(behavior): derive visible reaction timeline events"
```

---

## Task 7: Timeline Window, Ordering, And Gap Events

**Files:**
- Modify: `src/application/behavior/DefaultChatTimelineAssembler.ts`
- Modify: `test/ChatTimelineAssembler.test.ts`

- [ ] **Step 1: Add tests for window limit and trigger inclusion**

Add to `test/ChatTimelineAssembler.test.ts`:

```ts
it('keeps the last configured visible events before the latest trigger and includes the trigger', async () => {
  const inputMessages = [
    message({ id: 1, content: 'old 1', sentAt: '2026-06-06T10:00:00.000Z' }),
    message({ id: 2, content: 'old 2', sentAt: '2026-06-06T10:00:01.000Z' }),
    message({ id: 3, content: 'trigger', sentAt: '2026-06-06T10:00:02.000Z' }),
  ];
  const { assembler } = makeAssembler({
    config: { currentTimelineLookbackEventLimit: 1 },
  });

  const result = await assembler.assemble({
    chatId: -100,
    messages: inputMessages,
    triggerMessageIds: [3],
    contextMessageIds: [],
    batchMessageIds: [],
  });

  expect(
    result.promptContext.currentTimeline
      .filter((event) => event.type === 'message')
      .map((event) => event.storedMessageId)
  ).toEqual([2, 3]);
});
```

- [ ] **Step 2: Add test for gap markers**

```ts
it('inserts gap markers when visible event delta exceeds largeGapMs', async () => {
  const { assembler } = makeAssembler({
    config: { largeGapMs: 5 * 60_000 },
  });
  const result = await assembler.assemble({
    chatId: -100,
    messages: [
      message({ id: 1, sentAt: '2026-06-06T10:00:00.000Z' }),
      message({ id: 2, sentAt: '2026-06-06T10:27:00.000Z' }),
    ],
    triggerMessageIds: [2],
    contextMessageIds: [],
    batchMessageIds: [],
  });

  expect(result.promptContext.currentTimeline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'gap', durationMs: 27 * 60_000 }),
    ])
  );
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm test -- test/ChatTimelineAssembler.test.ts -t "configured visible events|gap markers"`

Expected: FAIL.

- [ ] **Step 4: Implement stable visible-event ordering**

Rules:

- Sort visible events by parsed timestamp ascending.
- Message timestamp is `sentAt`; if `sentAt` is null, order by stored id around known events and render `time unknown`.
- Reaction timestamp is `createdAt`.
- Pick latest trigger id as the anchor. If no trigger id exists, anchor is the newest visible event.
- Current timeline is last `currentTimelineLookbackEventLimit` visible events before the anchor plus all trigger message events.
- Insert gap events after windowing, between adjacent visible events with both timestamps when delta exceeds `largeGapMs`.

Add helpers:

```ts
  private eventTimeMs(event: ChatTimelineMessageEvent | ChatTimelineBotReactionEvent): number | null {
    const value = event.type === 'message' ? event.sentAt : event.createdAt;
    if (value == null) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
```

When inserting gaps, do not create gaps before/after unknown-time events.

- [ ] **Step 5: Respect `includeVisibleBotActions`**

Add test:

```ts
it('can disable visible bot action events through config', async () => {
  const target = message({ id: 75, messageId: 900 });
  const { assembler } = makeAssembler({
    config: { includeVisibleBotActions: false },
    events: [makeSentReactionBehaviorEvent({ id: 76, targetStoredId: 75 })],
  });

  const result = await assembler.assemble({
    chatId: -100,
    messages: [target],
    triggerMessageIds: [75],
    contextMessageIds: [],
    batchMessageIds: [],
  });

  expect(result.promptContext.currentTimeline).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'bot_reaction' })])
  );
});
```

Implement by returning no reaction events when `includeVisibleBotActions` is false.

- [ ] **Step 6: Keep failed diagnostic flag guarded**

Do not implement failed-action prompt rendering. Add a test proving the flag remains false by default in Task 4. In code, leave `includeFailedBotActionsInPrompt` unused except for a comment near reaction extraction:

```ts
// Guarded diagnostic switch exists in config, but v1 prompt rendering only exposes sent visible actions.
```

- [ ] **Step 7: Run focused tests**

Run: `pnpm test -- test/ChatTimelineAssembler.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/application/behavior/DefaultChatTimelineAssembler.ts test/ChatTimelineAssembler.test.ts
git commit -m "feat(behavior): window chat timeline and mark large gaps"
```

---

## Task 8: Reply Chain Assembly

**Files:**
- Modify: `src/application/behavior/DefaultChatTimelineAssembler.ts`
- Modify: `test/ChatTimelineAssembler.test.ts`

- [ ] **Step 1: Add reply-chain test**

In `test/ChatTimelineAssembler.test.ts`, add:

```ts
it('builds a reply chain from trigger through Telegram reply targets', async () => {
  const root = message({
    id: 10,
    messageId: 100,
    content: 'старый вопрос',
    sentAt: '2026-06-06T09:00:00.000Z',
  });
  const middle = message({
    id: 11,
    messageId: 101,
    content: 'ответ',
    replyToMessageId: 100,
    sentAt: '2026-06-06T09:01:00.000Z',
  });
  const trigger = message({
    id: 12,
    messageId: 102,
    content: 'Карл объяснись',
    replyToMessageId: 101,
    sentAt: '2026-06-06T10:00:00.000Z',
  });
  const byTelegram = new Map([
    [101, middle],
    [100, root],
  ]);
  const { assembler } = makeAssembler({
    messages: {
      findByChatAndTelegramMessageId: vi.fn(
        async (_chatId: number, telegramMessageId: number) =>
          byTelegram.get(telegramMessageId) ?? null
      ),
    },
  });

  const result = await assembler.assemble({
    chatId: -100,
    messages: [trigger],
    triggerMessageIds: [12],
    contextMessageIds: [],
    batchMessageIds: [],
  });

  expect(result.messages.map((item) => item.id)).toEqual([10, 11, 12]);
  expect(result.promptContext.replyChain.map((event) => event.storedMessageId)).toEqual([
    10,
    11,
    12,
  ]);
});
```

- [ ] **Step 2: Add reply limit test**

```ts
it('limits reply chain length by config', async () => {
  const root = message({ id: 10, messageId: 100, content: 'root' });
  const trigger = message({
    id: 12,
    messageId: 102,
    content: 'trigger',
    replyToMessageId: 100,
  });
  const { assembler } = makeAssembler({
    config: { replyChainMessageLimit: 1 },
    messages: {
      findByChatAndTelegramMessageId: vi.fn().mockResolvedValue(root),
    },
  });

  const result = await assembler.assemble({
    chatId: -100,
    messages: [trigger],
    triggerMessageIds: [12],
    contextMessageIds: [],
    batchMessageIds: [],
  });

  expect(result.promptContext.replyChain.map((event) => event.storedMessageId)).toEqual([12]);
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm test -- test/ChatTimelineAssembler.test.ts -t "reply chain"`

Expected: FAIL.

- [ ] **Step 4: Implement reply-chain traversal**

Implementation rules:

- Use latest trigger message by stored id as the starting point.
- Include the trigger itself.
- Walk `replyToMessageId` as Telegram message ids through `messages.findByChatAndTelegramMessageId(chatId, telegramMessageId)`.
- Stop at `replyChainMessageLimit`, missing target, repeated stored id, or null `replyToMessageId`.
- Reverse before returning so `REPLY_CHAIN` is chronological.
- Merge fetched chain messages into `ChatTimelineAssembly.messages` so `MessageReferenceMap.fromMessages(context.messages)` can resolve their `#N` refs.

Representative logic:

```ts
  private async buildReplyChain(params: {
    chatId: number;
    trigger: StoredBehaviorMessage | null;
    knownById: Map<number, StoredBehaviorMessage>;
  }): Promise<StoredBehaviorMessage[]> {
    const chain: StoredBehaviorMessage[] = [];
    const seen = new Set<number>();
    let current = params.trigger;

    while (
      current != null &&
      chain.length < this.config.replyChainMessageLimit &&
      !seen.has(current.id)
    ) {
      chain.push(current);
      seen.add(current.id);
      const replyTo = current.replyToMessageId;
      if (replyTo == null) break;
      current =
        [...params.knownById.values()].find((m) => m.messageId === replyTo) ??
        (await this.messages.findByChatAndTelegramMessageId(
          params.chatId,
          replyTo
        ));
    }

    return chain.reverse();
  }
```

- [ ] **Step 5: Rebuild events after merging extra messages**

After fetching reply-chain messages, merge them into a `Map<number, StoredBehaviorMessage>`, sort by id, then build message events and current timeline from the merged list.

- [ ] **Step 6: Run focused tests**

Run: `pnpm test -- test/ChatTimelineAssembler.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/application/behavior/DefaultChatTimelineAssembler.ts test/ChatTimelineAssembler.test.ts
git commit -m "feat(behavior): assemble explicit reply chains for prompts"
```

---

## Task 9: Wire Timeline Into Behavior Context

**Files:**
- Modify: `src/application/prompts/PromptTypes.ts`
- Modify: `src/application/behavior/DefaultBehaviorContextAssembler.ts`
- Modify: `test/BehaviorContextAssembler.test.ts`

- [ ] **Step 1: Add failing context assembler test**

In `test/BehaviorContextAssembler.test.ts`, update `makeAssembler(...)` to accept a timeline assembler mock. Add:

```ts
it('attaches chat timeline context and uses enriched timeline messages', async () => {
  const recent: ChatMessage[] = [
    { id: 3, chatId: 1, role: 'user', content: 'trigger' },
  ];
  const timelineAssembler = {
    assemble: vi.fn().mockResolvedValue({
      messages: [
        { id: 1, chatId: 1, role: 'user', content: 'reply target' },
        { id: 3, chatId: 1, role: 'user', content: 'trigger' },
      ],
      promptContext: {
        replyChain: [],
        currentTimeline: [],
      },
    }),
  };
  const { assembler } = makeAssembler({ recent, timelineAssembler });

  const ctx = await assembler.assemble({
    chatId: 1,
    triggerMessageIds: [3],
    contextMessageIds: [],
    gate,
  });

  expect(timelineAssembler.assemble).toHaveBeenCalledWith(
    expect.objectContaining({
      chatId: 1,
      triggerMessageIds: [3],
    })
  );
  expect(ctx.messages.map((message) => message.id)).toEqual([1, 3]);
  expect(ctx.timeline).toEqual({ replyChain: [], currentTimeline: [] });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- test/BehaviorContextAssembler.test.ts -t "chat timeline"`

Expected: FAIL.

- [ ] **Step 3: Add prompt context field**

In `PromptTypes.ts`:

```ts
import type { ChatTimelinePromptContext } from '@/application/behavior/ChatTimelineAssembler';
```

Add to `BehaviorPromptContext`:

```ts
  timeline?: ChatTimelinePromptContext;
```

- [ ] **Step 4: Inject timeline assembler**

In `DefaultBehaviorContextAssembler`, inject:

```ts
    @inject(CHAT_TIMELINE_ASSEMBLER_ID)
    private readonly timelineAssembler: ChatTimelineAssembler,
```

after `EnvService` or near message dependencies.

After `mergedMessages` is computed:

```ts
    const timelineAssembly = await this.timelineAssembler.assemble({
      chatId,
      messages: mergedMessages,
      triggerMessageIds,
      contextMessageIds,
      batchMessageIds,
    });
```

Return:

```ts
      messages: timelineAssembly.messages,
      timeline: timelineAssembly.promptContext,
```

Keep the state loading code unchanged.

- [ ] **Step 5: Update tests and container**

Update all direct `new DefaultBehaviorContextAssembler(...)` test construction to pass a timeline assembler mock.

The container binding was added in Task 6, so no new binding should be required here.

- [ ] **Step 6: Run focused tests**

Run: `pnpm test -- test/BehaviorContextAssembler.test.ts test/container.behavior.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/application/prompts/PromptTypes.ts src/application/behavior/DefaultBehaviorContextAssembler.ts test/BehaviorContextAssembler.test.ts
git commit -m "feat(behavior): attach timeline context to behavior decisions"
```

---

## Task 10: Timeline Formatter And Prompt Template

**Files:**
- Create: `src/application/prompts/ChatTimelineFormatter.ts`
- Create: `prompts/behavior_chat_context_guide_prompt.md`
- Modify: `src/application/interfaces/env/EnvService.ts`
- Modify: `src/infrastructure/config/DefaultEnvService.ts`
- Modify: `src/infrastructure/config/TestEnvService.ts`
- Modify: `test/ChatTimelineFormatter.test.ts`
- Modify: `test/PromptTemplateService.test.ts`

- [ ] **Step 1: Write formatter tests**

Create `test/ChatTimelineFormatter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  formatCurrentChatTimeline,
  formatReplyChain,
} from '../src/application/prompts/ChatTimelineFormatter';
import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';
import type {
  ChatTimelineEvent,
  ChatTimelineMessageEvent,
} from '../src/application/behavior/ChatTimelineAssembler';

function msg(overrides: Partial<ChatTimelineMessageEvent>): ChatTimelineMessageEvent {
  return {
    type: 'message',
    storedMessageId: 75,
    telegramMessageId: 500,
    chatId: -100,
    role: 'user',
    userId: 7,
    username: 'oleg',
    fullName: 'Олег',
    content: 'Земля круглая',
    sentAt: '2026-06-06T10:41:03.000Z',
    replyToTelegramMessageId: null,
    replyToUserId: null,
    replyUsername: null,
    replyText: null,
    sourceType: 'text',
    markers: {
      trigger: false,
      gateContext: false,
      batch: false,
      addressedToSelf: false,
    },
    ...overrides,
  };
}

describe('ChatTimelineFormatter', () => {
  it('renders reaction events as visible events without intent or reason', () => {
    const refMap = MessageReferenceMap.fromMessages([{ id: 75 }]);
    const events: ChatTimelineEvent[] = [
      msg({ storedMessageId: 75 }),
      {
        type: 'bot_reaction',
        eventId: 'E76.1',
        chatId: -100,
        emoji: '🤡',
        targetStoredMessageId: 75,
        targetTelegramMessageId: 500,
        createdAt: '2026-06-06T10:41:21.000Z',
      },
    ];

    const out = formatCurrentChatTimeline(events, refMap);

    expect(out).toContain('[event E76.1]');
    expect(out).toContain('Carl reacted 🤡 to msg #1');
    expect(out).not.toContain('mockery');
    expect(out).not.toContain('ambient_reaction');
  });

  it('renders gap markers and unknown timestamps', () => {
    const refMap = MessageReferenceMap.fromMessages([{ id: 75 }, { id: 80 }]);
    const out = formatCurrentChatTimeline(
      [
        msg({ storedMessageId: 75, sentAt: null }),
        { type: 'gap', durationMs: 27 * 60_000 },
        msg({
          storedMessageId: 80,
          content: 'Карл объяснись',
          sentAt: '2026-06-06T11:09:40.000Z',
          markers: {
            trigger: true,
            gateContext: false,
            batch: false,
            addressedToSelf: true,
          },
        }),
      ],
      refMap
    );

    expect(out).toContain('time unknown');
    expect(out).toContain('--- 27 minutes later ---');
    expect(out).toContain('[TRIGGER]');
    expect(out).toContain('[to:you]');
  });

  it('renders reply chain before current timeline content', () => {
    const refMap = MessageReferenceMap.fromMessages([{ id: 10 }, { id: 12 }]);
    const out = formatReplyChain(
      [
        msg({ storedMessageId: 10, content: 'old target' }),
        msg({ storedMessageId: 12, content: 'reply trigger' }),
      ],
      refMap
    );

    expect(out.indexOf('old target')).toBeLessThan(out.indexOf('reply trigger'));
    expect(out).toContain('REPLY_CHAIN');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm test -- test/ChatTimelineFormatter.test.ts`

Expected: FAIL because formatter does not exist.

- [ ] **Step 3: Implement formatter**

Create `ChatTimelineFormatter.ts`.

Required exported functions:

```ts
export function formatReplyChain(
  events: readonly ChatTimelineMessageEvent[],
  refMap: MessageReferenceMap
): string;

export function formatCurrentChatTimeline(
  events: readonly ChatTimelineEvent[],
  refMap: MessageReferenceMap
): string;
```

Formatting rules:

- Message line:

```text
[msg #2] 2026-06-06 11:09:40Z Олег [userId:7] [role:user] [source:text] [TRIGGER] [to:you]:
Карл объяснись
```

- Unknown message time:

```text
[msg #1] time unknown Олег [userId:7] [role:user] [source:text]:
старое сообщение без сохраненного времени
```

- Reaction event:

```text
[event E76.1] 2026-06-06 10:41:21Z Carl reacted 🤡 to msg #1
```

- If target is not in `refMap`, render:

```text
[event E76.1] 2026-06-06 10:41:21Z Carl reacted 🤡 to an older message outside this prompt
```

This avoids exposing raw store or Telegram ids.

- Gap:

```text
--- 27 minutes later ---
```

- Reply excerpt under message when `replyText` exists:

```text
↳ reply to @anna: "quoted text"
```

Use the existing truncation behavior from `PromptBuilder` as a guide, but keep the formatter pure.

- [ ] **Step 4: Add prompt template key**

In `EnvService.ts`, add to `PromptFiles`:

```ts
  behaviorChatContextGuide: string;
```

In `DefaultEnvService.getPromptFiles()` and `TestEnvService.getPromptFiles()`, add:

```ts
      behaviorChatContextGuide: 'prompts/behavior_chat_context_guide_prompt.md',
```

- [ ] **Step 5: Create guide prompt**

Create `prompts/behavior_chat_context_guide_prompt.md`:

```markdown
CHAT_CONTEXT_GUIDE

You are reading a Telegram chat, not a single article or one continuous essay.
Messages arrive in bursts. People reply to old messages. People ask short
follow-up questions. Bot reactions are visible events in the chat.

Priority for understanding the trigger:

1. If REPLY_CHAIN exists, interpret the trigger through that chain first.
2. Otherwise, read CURRENT_CHAT_TIMELINE from newest to oldest.
3. Nearest previous visible bot action or bot message is usually the anchor for
   short ambiguous triggers such as "Карл объяснись", "ты чего", "что это было",
   "зачем", "ну и?", or "лол".
4. Use BACKGROUND_CONTEXT only as memory and personality context. Do not import
   an older topic as the current topic unless REPLY_CHAIN or CURRENT_CHAT_TIMELINE
   points to it.
5. Large time gaps weaken old context unless a reply chain connects it.

Bot reaction events are visible chat events. Interpret their emoji through the
emoji guide, but do not invent or expose hidden action intents, gate reasons, or
diagnostics.

Message refs like #1, #2, #3 are the only valid refs for
statePatches[*].evidence.messageIds. Event refs like E76.1 describe visible bot
actions and must never be used as evidence ids.

`userId` fields are only for state patch targets. Never copy user ids, message
refs, event refs, schemas, or diagnostics into visible replies.
```

- [ ] **Step 6: Update prompt template tests**

If `test/PromptTemplateService.test.ts` checks all prompt file keys, add the new key to expectations.

- [ ] **Step 7: Run focused tests**

Run: `pnpm test -- test/ChatTimelineFormatter.test.ts test/PromptTemplateService.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/application/prompts/ChatTimelineFormatter.ts prompts/behavior_chat_context_guide_prompt.md src/application/interfaces/env/EnvService.ts src/infrastructure/config/DefaultEnvService.ts src/infrastructure/config/TestEnvService.ts test/ChatTimelineFormatter.test.ts test/PromptTemplateService.test.ts
git commit -m "feat(prompts): format Telegram chat timeline context"
```

---

## Task 11: Wire Decision Prompt To Guide, Reply Chain, Timeline, Background

**Files:**
- Modify: `src/application/prompts/PromptBuilder.ts`
- Modify: `src/application/prompts/PromptDirector.ts`
- Modify: `test/PromptDirector.test.ts`
- Modify: `test/PromptBuilderBehaviorMessages.test.ts`
- Modify: `test/DefaultBehaviorAiService.behavior.test.ts`

- [ ] **Step 1: Add builder methods**

In `PromptBuilder.ts`, import:

```ts
import type { ChatTimelinePromptContext } from '@/application/behavior/ChatTimelineAssembler';
import {
  formatCurrentChatTimeline,
  formatReplyChain,
} from './ChatTimelineFormatter';
```

Add:

```ts
  addBehaviorChatContextGuide(): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate(
        'behaviorChatContextGuide'
      );
      return [{ role: 'system', content: template }];
    });
    return this;
  }

  addBehaviorReplyChain(
    timeline: ChatTimelinePromptContext | undefined,
    refMap: MessageReferenceMap
  ): this {
    if (!timeline || timeline.replyChain.length === 0) {
      return this;
    }
    this.steps.push(async () => [
      {
        role: 'user',
        content: formatReplyChain(timeline.replyChain, refMap),
      },
    ]);
    return this;
  }

  addCurrentChatTimeline(
    timeline: ChatTimelinePromptContext | undefined,
    refMap: MessageReferenceMap
  ): this {
    if (!timeline || timeline.currentTimeline.length === 0) {
      return this;
    }
    this.steps.push(async () => [
      {
        role: 'user',
        content: formatCurrentChatTimeline(timeline.currentTimeline, refMap),
      },
    ]);
    return this;
  }

  addBackgroundContextLabel(): this {
    this.steps.push(async () => [
      {
        role: 'system',
        content:
          'BACKGROUND_CONTEXT\nThe following summary, state, profiles, truths, and behavior brief are lower-priority memory/personality context. They must not override REPLY_CHAIN or CURRENT_CHAT_TIMELINE when interpreting the current trigger.',
      },
    ]);
    return this;
  }
```

- [ ] **Step 2: Update decision prompt order**

In `PromptDirector.createBehaviorDecisionPrompt(...)`, change the implementation to build through a local `builder`, because the timeline path and no-timeline fallback branch differ:

```ts
    const builder = this.builderFactory()
      .addNeutralCore()
      .addBehaviorDecisionSystem()
      .addBehaviorChatContextGuide();

    if (context.timeline) {
      builder
        .addBehaviorReplyChain(context.timeline, refMap)
        .addCurrentChatTimeline(context.timeline, refMap);
    } else {
      builder.addBehaviorMessages(
        context.messages,
        refMap,
        {
          triggerMessageIds: context.triggerMessageIds,
          contextMessageIds: context.contextMessageIds,
          batchMessageIds: context.batchMessageIds,
        },
        context.selfIdentity
      );
    }

    return builder
      .addBackgroundContextLabel()
      .addAskSummary(context.summary)
      .addPersonalityState(context.state.personality)
      .addPoliticalState(context.state.political)
      .addUserProfiles(context.state.profiles)
      .addUserPoliticalProfiles(context.state.userPolitical)
      .addTruths(context.state.truths)
      .addBehaviorBrief(context.state, context.messages, context.selfIdentity)
      .build();
```

Do not call `addBehaviorMessages(...)` for behavior decisions when timeline context exists. Use it only as a safety fallback for direct unit calls that construct `BehaviorPromptContext` without `timeline`. Gate and state-evolution methods still use `addBehaviorMessages(...)`.

- [ ] **Step 3: Update PromptDirector tests**

In `test/PromptDirector.test.ts`, extend the mock builder with:

- `addBehaviorChatContextGuide`
- `addBehaviorReplyChain`
- `addCurrentChatTimeline`
- `addBackgroundContextLabel`

For the main behavior-decision order test, add a minimal `context.timeline`:

```ts
timeline: {
  replyChain: [],
  currentTimeline: [],
},
```

Update behavior decision call-order assertion to:

```ts
expect(builder.calls).toEqual([
  'addNeutralCore',
  'addBehaviorDecisionSystem',
  'addBehaviorChatContextGuide',
  'addBehaviorReplyChain',
  'addCurrentChatTimeline',
  'addBackgroundContextLabel',
  'addAskSummary',
  'addPersonalityState',
  'addPoliticalState',
  'addUserProfiles',
  'addUserPoliticalProfiles',
  'addTruths',
  'addBehaviorBrief',
  'build',
]);
```

Keep gate prompt assertion expecting `addBehaviorMessages`.

- [ ] **Step 4: Add fallback test**

Add a test proving decision prompt without `context.timeline` falls back to old message rendering and still includes background:

```ts
expect(builder.addBehaviorMessages).toHaveBeenCalledWith(
  context.messages,
  refMap,
  {
    triggerMessageIds: context.triggerMessageIds,
    contextMessageIds: context.contextMessageIds,
    batchMessageIds: context.batchMessageIds,
  },
  context.selfIdentity
);
expect(builder.addBackgroundContextLabel).toHaveBeenCalled();
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm test -- test/PromptDirector.test.ts test/PromptBuilderBehaviorMessages.test.ts test/DefaultBehaviorAiService.behavior.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/application/prompts/PromptBuilder.ts src/application/prompts/PromptDirector.ts test/PromptDirector.test.ts test/PromptBuilderBehaviorMessages.test.ts test/DefaultBehaviorAiService.behavior.test.ts
git commit -m "feat(prompts): use chat timeline in behavior decisions"
```

---

## Task 12: Prompt Text Updates And Incident Regression

**Files:**
- Modify: `prompts/behavior_decision_system_prompt.md`
- Modify: `test/ChatTimelineAssembler.test.ts`
- Modify: `test/PromptDirector.test.ts`
- Test: `test/ChatTimelineFormatter.test.ts`

- [ ] **Step 1: Tighten decision prompt instructions**

In `prompts/behavior_decision_system_prompt.md`, update the context-reading parts so they no longer mention only old `[to:...]` lines. Keep the emoji guide and action schemas intact.

Add near the existing "Read the room before acting" section:

```markdown
Use CHAT_CONTEXT_GUIDE, REPLY_CHAIN, and CURRENT_CHAT_TIMELINE as the primary
current context. BACKGROUND_CONTEXT is memory/personality context and is lower
priority for resolving what the latest short trigger refers to.

For ambiguous short trigger messages, resolve the reference by reading
CURRENT_CHAT_TIMELINE from newest to oldest. In messengers, short follow-ups
usually refer to the nearest previous visible bot action or message.

If REPLY_CHAIN is present, it is the primary anchor. Current timeline still
sets the atmosphere, but must not override the explicit reply target unless the
trigger text clearly changes topic.
```

Replace the old source section with:

```markdown
Message source field:

- `source:text` means the user typed the message.
- `source:voice` means the message text is a transcription of a Telegram voice
  message. Treat it as the user's message content, while allowing for small
  speech-recognition mistakes in wording or punctuation.
```

Add evidence distinction near the existing evidence instructions:

```markdown
Only message refs like `#1` are valid evidence ids. Bot event refs like `E76.1`
are visible timeline events, not messages, and must never appear in
statePatches[*].evidence.messageIds.
```

- [ ] **Step 2: Add regression fixture for `Карл объяснись` incident**

In `test/ChatTimelineAssembler.test.ts`, add a regression test:

```ts
it('regression: ambiguous "Карл объяснись" sees recent clown reactions before older topic', async () => {
  const older = message({
    id: 70,
    messageId: 870,
    content: 'AI agents will replace juniors',
    sentAt: '2026-06-06T10:00:00.000Z',
  });
  const bait = message({
    id: 75,
    messageId: 875,
    content: 'Земля плоская',
    sentAt: '2026-06-06T10:40:00.000Z',
  });
  const trigger = message({
    id: 80,
    messageId: 880,
    content: 'Карл объяснись',
    sentAt: '2026-06-06T10:41:00.000Z',
  });
  const { assembler } = makeAssembler({
    events: [makeSentReactionBehaviorEvent({ id: 76, targetStoredId: 75, emoji: '🤡' })],
  });

  const result = await assembler.assemble({
    chatId: -100,
    messages: [older, bait, trigger],
    triggerMessageIds: [80],
    contextMessageIds: [],
    batchMessageIds: [],
  });

  expect(result.promptContext.currentTimeline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'bot_reaction', emoji: '🤡' }),
      expect.objectContaining({ type: 'message', storedMessageId: 80 }),
    ])
  );
});
```

Also add a formatter/prompt-director assertion that the final decision prompt contains:

- `CHAT_CONTEXT_GUIDE`
- `CURRENT_CHAT_TIMELINE`
- `Carl reacted 🤡`
- `BACKGROUND_CONTEXT`
- no `intent: mockery`
- no `ambient_reaction`

- [ ] **Step 3: Run prompt-focused tests**

Run:

```bash
pnpm test -- test/ChatTimelineAssembler.test.ts test/ChatTimelineFormatter.test.ts test/PromptDirector.test.ts
```

Expected: PASS.

- [ ] **Step 4: Build prompt templates**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prompts/behavior_decision_system_prompt.md test/ChatTimelineAssembler.test.ts test/ChatTimelineFormatter.test.ts test/PromptDirector.test.ts
git commit -m "feat(prompts): teach decision prompt to read chat timelines"
```

---

## Task 13: Full Verification

**Files:**
- All changed implementation and test files.

- [ ] **Step 1: Run autofix**

Run:

```bash
pnpm lint:fix
pnpm format:fix
```

Expected: commands complete. If formatting changes files, include them in the relevant implementation commit or a final test-stabilization commit.

- [ ] **Step 2: Run typecheck**

Run: `pnpm type:check`

Expected: PASS.

- [ ] **Step 3: Run focused behavior/prompt suite**

Run:

```bash
pnpm test -- test/ChatTimelineAssembler.test.ts test/ChatTimelineFormatter.test.ts test/BehaviorContextAssembler.test.ts test/PromptDirector.test.ts test/DefaultBehaviorAiService.behavior.test.ts test/DefaultBehaviorExecutor.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run persistence and migration suite**

Run:

```bash
pnpm test -- test/messageSentAtMigration024.test.ts test/sqliteRepositories.test.ts test/SQLiteMessageRepository.reply.test.ts test/behaviorEventRepositories.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 6: Run build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 7: Optional prompt-log manual check**

With `LOG_PROMPTS=1`, run a local behavior-decision scenario or existing manual job that builds decision prompts. Inspect `prompts.log` and verify:

- `CHAT_CONTEXT_GUIDE` appears before timeline.
- `REPLY_CHAIN` appears only when trigger message is a Telegram reply.
- `CURRENT_CHAT_TIMELINE` contains timestamps, gap markers, trigger marker, and bot reaction events.
- Successful reactions show only emoji and target message refs, not internal intent/reason.
- `BACKGROUND_CONTEXT` appears after current timeline.
- State patch evidence instructions say `#N` only, never `E*`.

- [ ] **Step 8: Inspect git status**

Run: `git status --short`

Expected:

- implementation, prompt, migration, and test files are staged/committed as intended;
- `docs/superpowers/*` remains untracked or ignored and is not committed.

---

## Self-Check

Spec coverage:

- Hybrid derived timeline source: Tasks 5-8.
- Visible reality only: Tasks 6, 10, 12.
- Successful bot reactions as separate events: Tasks 6, 10.
- Reply-chain priority: Tasks 8, 10, 12.
- Recency-first bottom-up reading: Tasks 10, 12.
- Last 15 visible events plus trigger: Tasks 4, 7.
- Timestamps and large gaps: Tasks 1-3, 7, 10.
- Dedicated config: Task 4.
- Prompt structure guide -> reply chain -> current timeline -> background: Tasks 10-11.
- Distinct message refs vs event refs: Tasks 10, 12.
- No first-class `chat_events` table in v1: all tasks derive from current `messages` and `behavior_events`.

Known deliberate tradeoffs:

- Assistant `sentAt` uses local send time fallback instead of changing `ChatMessenger.sendMessage(...)` to expose Telegram `date`.
- User ids remain present in timeline message headers for current live user-profile patch compatibility; the guide explicitly forbids copying them into visible replies.
- Failed bot actions remain database diagnostics only; `includeFailedBotActionsInPrompt` is a guarded future diagnostic switch and stays unused in normal rendering.
