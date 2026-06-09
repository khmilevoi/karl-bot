# Carl Behavior Prompts & Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать так, чтобы данные из БД реально управляли поведением Carl (тон, реакции, эмодзи), он лучше понимал контекст/адресацию/реплаи, чаще реагировал «на комнату», эволюционировал в интересного собеседника, и стабильно сохранял истины о себе.

**Architecture:** Поверх существующего пайплайна gate → decision → state-evolution. Добавляем (1) чистый слой синтеза state в директивный «бриф» прямо перед сообщениями; (2) аддитивную миграцию + захват reply-target для понимания адресации; (3) маркеры адресации и привязку `#N` в рендере сообщений; (4) расширение схем (gate-reason, evolution truth-патчи); (5) правки промптов. Источник истины (JSON state) не меняется — бриф его пре-дайджестит.

**Tech Stack:** TypeScript, Node, Inversify (DI), Zod (схемы), OpenAI structured outputs, SQLite (`migrations/*.sql`), Vitest, grammY (Telegram).

**Спека:** `docs/superpowers/specs/2026-06-05-carl-behavior-prompts-design.md`

**Правила репо:**
- `docs/superpowers/` — локальные артефакты, **не коммитить**.
- Без `any`/`@ts-`; не использовать тип `undefined` явно (только через `?`), вместо значения — `null`.
- Перед коммитом: `pnpm format:fix` и `pnpm lint:fix`.
- Тесты: `pnpm test` (всё) или `pnpm vitest run <file>` (один файл). Можно префиксовать `rtk`.

---

## Карта файлов

**Миграция / данные (фаза 1):**
- Create: `migrations/021_add_reply_target_fields.up.sql`, `.down.sql`
- Modify: `src/domain/messages/ChatMessage.ts` — поля `replyToMessageId?`, `replyToUserId?`
- Modify: `src/application/interfaces/messages/MessageContextExtractor.ts` — поля в `MessageContext`
- Modify: `src/application/use-cases/messages/DefaultMessageContextExtractor.ts` — захват
- Modify: `src/application/use-cases/messages/MessageFactory.ts` — прокидывание (вкл. voice)
- Modify: `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts` — колонки

**Идентичность + бриф (фаза 2):**
- Modify: `src/application/prompts/PromptTypes.ts` — `SelfIdentity`, `selfIdentity?` в контексте
- Modify: `src/application/behavior/DefaultBehaviorContextAssembler.ts` — заполнить `selfIdentity`
- Create: `src/application/prompts/BehaviorBrief.ts` — чистая функция синтеза
- Modify: `src/application/prompts/PromptBuilder.ts` — шаг `addBehaviorBrief`
- Modify: `src/application/prompts/PromptDirector.ts` — подключить шаг

**Рендер адресации (фаза 3):**
- Modify: `src/application/prompts/PromptBuilder.ts` (`addBehaviorMessages`) — маркеры `[to:*]`, reply-to-self, `на #N`

**Схемы (фаза 4):**
- Modify: `src/domain/behavior/schemas/gate.ts` — reason `ambient_reaction`
- Modify: `src/domain/behavior/schemas/evolution.ts` — `truthPatches`
- Modify: `src/domain/behavior/schemas/patches.ts` — опц. `requestedOrigin` для позиций
- Modify: `src/application/behavior/OrdinalTranslation.ts` — `translateTruthPatches`
- Modify: `src/infrastructure/external/ChatGPTService.ts` — трансляция truthPatches
- Modify: `src/application/behavior/StatePatchApplicator.ts` (+ Default) — `applyTruthPatches`
- Modify: `src/application/behavior/DefaultStateEvolutionPass.ts` — вызвать применение truthPatches

**Конфиг (фаза 5):**
- Modify: `src/application/behavior/BehaviorConfig.ts` — `maxReactionsPerWindow`

**Промпты (фаза 6):**
- Modify: `prompts/neutral_core_prompt.md`
- Modify: `prompts/personality_state_prompt.md`, `political_state_prompt.md`,
  `user_profiles_prompt.md`, `user_political_profiles_prompt.md`, `truths_prompt.md`
- Modify: `prompts/behavior_decision_system_prompt.md`
- Modify: `prompts/behavior_gate_system_prompt.md`
- Modify: `prompts/state_evolution_system_prompt.md`

---

## Фаза 1 — Данные адресации (миграция + приём)

### Task 1: Миграция `021_add_reply_target_fields`

**Files:**
- Create: `migrations/021_add_reply_target_fields.up.sql`
- Create: `migrations/021_add_reply_target_fields.down.sql`

- [ ] **Step 1: Создать up-миграцию**

`migrations/021_add_reply_target_fields.up.sql`:

```sql
ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER;
ALTER TABLE messages ADD COLUMN reply_to_user_id INTEGER;
```

- [ ] **Step 2: Создать down-миграцию**

`migrations/021_add_reply_target_fields.down.sql`:

```sql
ALTER TABLE messages DROP COLUMN reply_to_message_id;
ALTER TABLE messages DROP COLUMN reply_to_user_id;
```

- [ ] **Step 3: Применить миграцию**

Run: `pnpm migration:up`
Expected: миграция 021 применяется без ошибок; статус up.

- [ ] **Step 4: Проверить откат и повторное применение**

Run: `pnpm migration:down && pnpm migration:up`
Expected: down удаляет колонки, up создаёт заново, без ошибок.

- [ ] **Step 5: Commit**

```bash
git add migrations/021_add_reply_target_fields.up.sql migrations/021_add_reply_target_fields.down.sql
git commit -m "feat(db): add reply_to_message_id/reply_to_user_id columns"
```

---

### Task 2: Захват reply-target в экстракторе

**Files:**
- Modify: `src/domain/messages/ChatMessage.ts`
- Modify: `src/application/interfaces/messages/MessageContextExtractor.ts`
- Modify: `src/application/use-cases/messages/DefaultMessageContextExtractor.ts`
- Test: `test/MessageContextExtractor.test.ts`

- [ ] **Step 1: Добавить поля в доменные типы**

В `src/domain/messages/ChatMessage.ts` добавить в интерфейс `ChatMessage` (после `quoteText?`):

```ts
  replyText?: string;
  replyUsername?: string;
  quoteText?: string;
  replyToMessageId?: number;
  replyToUserId?: number;
```

В `src/application/interfaces/messages/MessageContextExtractor.ts` расширить `MessageContext`:

```ts
export interface MessageContext {
  replyText?: string;
  replyUsername?: string;
  quoteText?: string;
  replyToMessageId?: number;
  replyToUserId?: number;
  username: string;
  fullName: string;
}
```

- [ ] **Step 2: Написать падающий тест**

Добавить в `test/MessageContextExtractor.test.ts` тест (рядом с существующими; стиль построения `ctx` взять из уже имеющихся тестов в файле):

```ts
it('captures reply target message id and user id', () => {
  const extractor = new DefaultMessageContextExtractor();
  const ctx = {
    message: {
      text: 'ответ',
      reply_to_message: {
        message_id: 555,
        text: 'оригинал',
        from: { id: 42, first_name: 'Анна' },
      },
    },
    from: { id: 7, first_name: 'Олег' },
  } as unknown as Context;

  const result = extractor.extract(ctx);

  expect(result.replyToMessageId).toBe(555);
  expect(result.replyToUserId).toBe(42);
  expect(result.replyText).toBe('оригинал');
});
```

- [ ] **Step 3: Запустить тест — убедиться, что падает**

Run: `pnpm vitest run test/MessageContextExtractor.test.ts -t "reply target"`
Expected: FAIL (`replyToMessageId` is undefined).

- [ ] **Step 4: Реализовать захват**

В `src/application/use-cases/messages/DefaultMessageContextExtractor.ts` внутри `extract`, в блоке `if (message?.reply_to_message)` добавить захват и расширить возврат:

```ts
    let replyText: string | undefined;
    let replyUsername: string | undefined;
    let quoteText: string | undefined;
    let replyToMessageId: number | undefined;
    let replyToUserId: number | undefined;

    if (message?.reply_to_message) {
      const pieces: string[] = [];
      const reply = message.reply_to_message as Record<string, unknown>;
      if (typeof reply.text === 'string') {
        pieces.push(reply.text);
      }
      if (typeof reply.caption === 'string') {
        pieces.push(reply.caption);
      }
      if (pieces.length > 0) {
        replyText = pieces.join('; ');
      }
      if (typeof reply.message_id === 'number') {
        replyToMessageId = reply.message_id;
      }

      const from = message.reply_to_message.from as
        | { id?: number; first_name?: string; last_name?: string; username?: string }
        | undefined;
      if (from) {
        if (typeof from.id === 'number') {
          replyToUserId = from.id;
        }
        if (from.first_name && from.last_name) {
          replyUsername = from.first_name + ' ' + from.last_name;
        } else {
          replyUsername = from.first_name ?? from.username;
        }
      }
    }
```

И обновить `return`:

```ts
    return {
      replyText,
      replyUsername,
      quoteText,
      replyToMessageId,
      replyToUserId,
      username,
      fullName,
    };
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит, и закоммитить**

Run: `pnpm vitest run test/MessageContextExtractor.test.ts`
Expected: PASS.

```bash
git add src/domain/messages/ChatMessage.ts src/application/interfaces/messages/MessageContextExtractor.ts src/application/use-cases/messages/DefaultMessageContextExtractor.ts test/MessageContextExtractor.test.ts
git commit -m "feat(messages): capture reply target id/user in extractor"
```

---

### Task 3: Прокидывание reply-полей в `MessageFactory` (вкл. фикс voice)

**Files:**
- Modify: `src/application/use-cases/messages/MessageFactory.ts`
- Test: `test/MessageFactory.test.ts`

- [ ] **Step 1: Написать падающие тесты**

Добавить в `test/MessageFactory.test.ts`:

```ts
it('fromUser carries reply target ids', () => {
  const ctx = {
    message: { text: 'привет', message_id: 10 },
    from: { id: 7, first_name: 'Олег' },
    chat: { id: -100 },
  } as unknown as Context;
  const meta = {
    username: 'oleg',
    fullName: 'Олег',
    replyText: 'orig',
    replyUsername: 'Анна',
    replyToMessageId: 555,
    replyToUserId: 42,
  } as MessageContext;

  const stored = MessageFactory.fromUser(ctx, meta);

  expect(stored.replyToMessageId).toBe(555);
  expect(stored.replyToUserId).toBe(42);
  expect(stored.replyText).toBe('orig');
});

it('fromUserContent (voice) carries reply context', () => {
  const ctx = {
    message: { message_id: 11 },
    from: { id: 7, first_name: 'Олег' },
    chat: { id: -100 },
  } as unknown as Context;
  const meta = {
    username: 'oleg',
    fullName: 'Олег',
    replyText: 'orig',
    replyUsername: 'Анна',
    quoteText: 'q',
    replyToMessageId: 555,
    replyToUserId: 42,
  } as MessageContext;

  const stored = MessageFactory.fromUserContent(ctx, meta, 'распознанный текст', 'voice');

  expect(stored.replyToMessageId).toBe(555);
  expect(stored.replyToUserId).toBe(42);
  expect(stored.replyText).toBe('orig');
  expect(stored.quoteText).toBe('q');
});
```

(Импорт `MessageContext` из `@/application/interfaces/messages/MessageContextExtractor`, если ещё не импортирован.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/MessageFactory.test.ts -t "reply"`
Expected: FAIL (поля undefined; voice-ветка не несёт reply).

- [ ] **Step 3: Реализовать прокидывание**

В `src/application/use-cases/messages/MessageFactory.ts`:

`fromUser` — расширить деструктуризацию и объект:

```ts
    const {
      replyText,
      replyUsername,
      quoteText,
      replyToMessageId,
      replyToUserId,
      username,
      fullName,
    } = meta;
```

и в возвращаемый объект добавить:

```ts
      replyText,
      replyUsername,
      quoteText,
      replyToMessageId,
      replyToUserId,
```

`fromUserContent` — заменить деструктуризацию и добавить reply-поля в объект:

```ts
    const {
      username,
      fullName,
      replyText,
      replyUsername,
      quoteText,
      replyToMessageId,
      replyToUserId,
    } = meta;
```

и в возвращаемый объект (рядом с `content`, `username`, …):

```ts
      replyText,
      replyUsername,
      quoteText,
      replyToMessageId,
      replyToUserId,
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm vitest run test/MessageFactory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/messages/MessageFactory.ts test/MessageFactory.test.ts
git commit -m "feat(messages): propagate reply target + fix voice losing reply context"
```

---

### Task 4: Колонки reply-target в `SQLiteMessageRepository`

**Files:**
- Modify: `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts`
- Test: `test/SQLiteMessageRepository.reply.test.ts` (создать)

- [ ] **Step 1: Написать падающий тест (round-trip)**

Создать `test/SQLiteMessageRepository.reply.test.ts`. Использовать существующий способ поднятия in-memory БД из других SQLite-тестов репозитория (взять паттерн из соседних `test/*Repository*` тестов: создание `DbProvider` на `:memory:` и прогон миграций). Тело теста:

```ts
it('round-trips reply target columns', async () => {
  // setup db + migrations via existing helper, then:
  const repo = new SQLiteMessageRepository(dbProvider);
  const id = await repo.insert({
    chatId: -100,
    messageId: 10,
    role: 'user',
    content: 'ответ',
    userId: 7,
    replyText: 'orig',
    replyUsername: 'Анна',
    replyToMessageId: 555,
    replyToUserId: 42,
  });

  const [msg] = await repo.findByIds([id]);
  expect(msg.replyToMessageId).toBe(555);
  expect(msg.replyToUserId).toBe(42);
});
```

> Если в репо нет готового хелпера поднятия БД для теста репозитория — взять способ из ближайшего существующего теста, который уже инстанцирует `SQLiteMessageRepository`/`DbProvider`, и переиспользовать его.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/SQLiteMessageRepository.reply.test.ts`
Expected: FAIL (колонки не читаются/не пишутся).

- [ ] **Step 3: Реализовать колонки**

В `src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts`:

`MessageRow` — добавить:

```ts
  reply_to_message_id: number | null;
  reply_to_user_id: number | null;
```

`SELECT_MESSAGE_COLUMNS` — добавить колонки `m.reply_to_message_id, m.reply_to_user_id`:

```ts
const SELECT_MESSAGE_COLUMNS =
  'SELECT m.id, m.role, m.content, u.username, u.first_name, u.last_name, m.reply_text, m.reply_username, m.quote_text, m.reply_to_message_id, m.reply_to_user_id, m.user_id, c.chat_id, m.message_id, m.source_type, m.processing_status FROM messages m LEFT JOIN users u ON m.user_id = u.id LEFT JOIN chats c ON m.chat_id = c.chat_id';
```

`rowToMessage` — добавить маппинг (после quote_text):

```ts
  if (r.reply_to_message_id != null) entry.replyToMessageId = r.reply_to_message_id;
  if (r.reply_to_user_id != null) entry.replyToUserId = r.reply_to_user_id;
```

`insert` — расширить деструктуризацию параметров:

```ts
  async insert({
    chatId,
    messageId,
    role,
    content,
    userId,
    replyText,
    replyUsername,
    quoteText,
    replyToMessageId,
    replyToUserId,
    sourceType,
    processingStatus,
  }: StoredMessage): Promise<number> {
```

и сам INSERT:

```ts
    const result = (await db.run(
      'INSERT INTO messages (chat_id, message_id, role, content, user_id, reply_text, reply_username, quote_text, reply_to_message_id, reply_to_user_id, source_type, processing_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      chatId,
      messageId ?? null,
      role,
      content,
      userId ?? 0,
      replyText ?? null,
      replyUsername ?? null,
      quoteText ?? null,
      replyToMessageId ?? null,
      replyToUserId ?? null,
      sourceType ?? 'text',
      processingStatus ?? 'ready'
    )) as { lastID?: number };
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm vitest run test/SQLiteMessageRepository.reply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/persistence/sqlite/SQLiteMessageRepository.ts test/SQLiteMessageRepository.reply.test.ts
git commit -m "feat(db): persist and read reply target columns"
```

---

## Фаза 2 — Идентичность бота + слой синтеза (бриф)

### Task 5: `selfIdentity` в контексте решения

**Files:**
- Modify: `src/application/prompts/PromptTypes.ts`
- Modify: `src/application/behavior/DefaultBehaviorContextAssembler.ts`
- Test: `test/BehaviorContextAssembler.test.ts`

- [ ] **Step 1: Добавить тип и поле**

В `src/application/prompts/PromptTypes.ts` добавить:

```ts
export interface SelfIdentity {
  id: number;
  username: string | null;
  name: string;
}
```

и в `BehaviorPromptContext` добавить поле (опционально, т.к. evolution-контекст его не заполняет):

```ts
export interface BehaviorPromptContext {
  summary: string;
  messages: BehaviorPromptMessage[];
  triggerMessageIds: number[];
  contextMessageIds: number[];
  batchMessageIds: number[];
  state: BehaviorPromptState;
  selfIdentity?: SelfIdentity;
}
```

- [ ] **Step 2: Написать падающий тест**

В `test/BehaviorContextAssembler.test.ts` добавить (мок messenger/env по образцу существующих моков в файле):

```ts
it('populates selfIdentity from messenger + env', async () => {
  // messenger mock: bot.botInfo = { id: 999, username: 'carl_bot' }
  // env mock: getBotName() => 'Карл'
  const ctx = await assembler.assemble({
    chatId: -100,
    triggerMessageIds: [],
    contextMessageIds: [],
    batchMessageIds: [],
    gate,
  });

  expect(ctx.selfIdentity).toEqual({ id: 999, username: 'carl_bot', name: 'Карл' });
});
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/BehaviorContextAssembler.test.ts -t "selfIdentity"`
Expected: FAIL (`selfIdentity` undefined).

- [ ] **Step 4: Реализовать заполнение**

В `src/application/behavior/DefaultBehaviorContextAssembler.ts` добавить инъекции и заполнение. Импорты:

```ts
import {
  CHAT_MESSENGER_ID,
  type ChatMessenger,
} from '@/application/interfaces/chat/ChatMessenger';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
```

В конструктор добавить параметры:

```ts
    @inject(CHAT_MESSENGER_ID) private readonly messenger: ChatMessenger,
    @inject(ENV_SERVICE_ID) private readonly env: EnvService,
```

В конце `assemble`, в возвращаемый объект добавить:

```ts
      selfIdentity: {
        id: this.messenger.bot.botInfo.id,
        username: this.messenger.bot.botInfo.username ?? null,
        name: this.env.getBotName(),
      },
```

> Если контейнерные тесты `test/container.behavior.test.ts` проверяют конструктор ассемблера — обновить их моки (добавить messenger/env).

- [ ] **Step 5: Запустить, прогнать контейнерный тест, закоммитить**

Run: `pnpm vitest run test/BehaviorContextAssembler.test.ts test/container.behavior.test.ts`
Expected: PASS.

```bash
git add src/application/prompts/PromptTypes.ts src/application/behavior/DefaultBehaviorContextAssembler.ts test/BehaviorContextAssembler.test.ts
git commit -m "feat(behavior): thread bot self-identity into decision context"
```

---

### Task 6: Чистый модуль `BehaviorBrief`

**Files:**
- Create: `src/application/prompts/BehaviorBrief.ts`
- Test: `test/BehaviorBrief.test.ts` (создать)

- [ ] **Step 1: Написать падающие тесты**

Создать `test/BehaviorBrief.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildBehaviorBrief } from '@/application/prompts/BehaviorBrief';
import type {
  BehaviorPromptMessage,
  BehaviorPromptState,
} from '@/application/prompts/PromptTypes';

function emptyState(chatId = -100): BehaviorPromptState {
  const now = '2026-06-05T00:00:00.000Z';
  return {
    personality: {
      chatId,
      identityNotes: [],
      values: [],
      speechStyle: { tone: 'neutral', humor: 'none', verbosity: 'short', formality: 'medium' },
      socialHabits: [],
      recurringThemes: [],
      lastUpdatedAt: now,
    },
    political: {
      chatId,
      ideologySummary: '',
      compass: { economic: 0, social: 0, economicConfidence: 0, socialConfidence: 0 },
      positions: [],
      uncertaintyAreas: [],
      influenceHistory: [],
      lastUpdatedAt: now,
    },
    profiles: [],
    truths: [],
    userPolitical: [],
  };
}

function msg(id: number, userId: number, username: string): BehaviorPromptMessage {
  return { id, chatId: -100, role: 'user', content: 'hi', userId, username } as BehaviorPromptMessage;
}

describe('buildBehaviorBrief', () => {
  it('returns reserved-mode text on empty state', () => {
    const brief = buildBehaviorBrief({ state: emptyState(), messages: [msg(1, 7, 'oleg')] });
    expect(brief).toContain('отношений пока нет');
    expect(brief).toContain('характер ещё не сформирован');
  });

  it('renders a mocking relationship card with cold tone and mocking emoji lean', () => {
    const state = emptyState();
    state.profiles = [
      {
        userId: 7,
        chatId: -100,
        username: 'oleg',
        affinityScore: -2,
        labels: [],
        patterns: [],
        grudges: [{ text: 'слил дедлайн', evidenceMessageIds: [1], status: 'active' }],
        trustLevel: 'low',
        preferredDistance: 'mocking',
        communicationStyle: '',
        conflictStyle: '',
        preferredTone: '',
        interests: [],
        updatedAt: '2026-06-05T00:00:00.000Z',
      },
    ];
    const brief = buildBehaviorBrief({ state, messages: [msg(1, 7, 'oleg')] });
    expect(brief).toContain('@oleg');
    expect(brief).toContain('колко');
    expect(brief).toContain('🤡');
    expect(brief).toContain('слил дедлайн');
  });

  it('includes identity line when selfIdentity provided', () => {
    const brief = buildBehaviorBrief({
      state: emptyState(),
      messages: [msg(1, 7, 'oleg')],
      selfIdentity: { id: 999, username: 'carl_bot', name: 'Карл' },
    });
    expect(brief).toContain('@carl_bot');
    expect(brief).toContain('Карл');
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/BehaviorBrief.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Реализовать модуль**

Создать `src/application/prompts/BehaviorBrief.ts`:

```ts
import type {
  BehaviorPromptMessage,
  BehaviorPromptState,
  SelfIdentity,
} from './PromptTypes';
import type { UserSocialProfile } from '@/domain/behavior/schemas/state';

const TONE_BY_DISTANCE: Record<UserSocialProfile['preferredDistance'], string> = {
  warm: 'тёплый, поддерживающий тон',
  neutral: 'ровный, нейтральный тон',
  cold: 'холодно и сдержанно',
  mocking: 'колко, с насмешкой',
  avoidant: 'коротко, держи дистанцию',
  hostile: 'резко и конфронтационно',
};

const EMOJI_BY_DISTANCE: Record<UserSocialProfile['preferredDistance'], string> = {
  warm: '🔥/🫶/🥹/❤️',
  neutral: '👀/🤔/🙏',
  cold: '🤡/👎/🫠',
  mocking: '🤡/💀/🫠',
  avoidant: '👀/🤔',
  hostile: '👎/🤡/💀',
};

function activeUserIds(messages: BehaviorPromptMessage[]): number[] {
  const ids = new Set<number>();
  for (const m of messages) {
    if (m.role === 'user' && typeof m.userId === 'number') {
      ids.add(m.userId);
    }
  }
  return [...ids];
}

function handle(profile: UserSocialProfile): string {
  return profile.username ? `@${profile.username}` : `id:${profile.userId}`;
}

function relationshipCard(profile: UserSocialProfile): string {
  const grudge = profile.grudges.find((g) => g.status === 'active');
  const grudgePart = grudge ? ` · обида: "${grudge.text}"` : '';
  const tone = TONE_BY_DISTANCE[profile.preferredDistance];
  const emoji = EMOJI_BY_DISTANCE[profile.preferredDistance];
  const interests =
    profile.interests.length > 0 ? ` · интересы: ${profile.interests.join(', ')}` : '';
  return (
    `${handle(profile)} — affinity ${profile.affinityScore} · distance: ${profile.preferredDistance} · ` +
    `trust: ${profile.trustLevel}${grudgePart}${interests} → ${tone}; reaction-уклон ${emoji}`
  );
}

function moodBrief(state: BehaviorPromptState): string {
  const s = state.personality.speechStyle;
  const c = state.political.compass;
  const isBlankStyle =
    s.tone === 'neutral' && s.humor === 'none' && state.personality.recurringThemes.length === 0;
  if (isBlankStyle) {
    return 'Характер ещё не сформирован — держись сдержанно, наблюдай, не строй из себя то, чего пока нет.';
  }
  const themes =
    state.personality.recurringThemes.length > 0
      ? ` Темы: ${state.personality.recurringThemes.join(', ')}.`
      : '';
  return (
    `Сейчас ты: tone=${s.tone}, humor=${s.humor}, verbosity=${s.verbosity}, formality=${s.formality}. ` +
    `Компас: эконом ${c.economic} / соц ${c.social} (увер. ${c.economicConfidence}/${c.socialConfidence}).${themes} ` +
    `Говори в этом голосе; в политике аргументируй с этих позиций сразу.`
  );
}

export function buildBehaviorBrief(params: {
  state: BehaviorPromptState;
  messages: BehaviorPromptMessage[];
  selfIdentity?: SelfIdentity;
}): string {
  const { state, messages, selfIdentity } = params;
  const lines: string[] = ['# Кто ты сейчас и как относиться к собеседникам'];

  if (selfIdentity) {
    const uname = selfIdentity.username ? `@${selfIdentity.username}` : '(без username)';
    lines.push(
      `Ты — ${selfIdentity.name} (${uname}). К тебе обращаются ТОЛЬКО когда пишут ${uname}, ` +
        `твоё имя как обращение, или отвечают (reply) на твоё сообщение. Остальное — чужой разговор.`
    );
  }

  lines.push(moodBrief(state));

  const ids = activeUserIds(messages);
  const cards = ids
    .map((id) => state.profiles.find((p) => p.userId === id))
    .filter((p): p is UserSocialProfile => p != null)
    .map(relationshipCard);

  if (cards.length > 0) {
    lines.push('Отношения с активными собеседниками:');
    lines.push(...cards);
  } else {
    lines.push('Отношений пока нет — держись нейтрально и наблюдай, кто есть кто.');
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm vitest run test/BehaviorBrief.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/prompts/BehaviorBrief.ts test/BehaviorBrief.test.ts
git commit -m "feat(prompts): add deterministic behavior brief synthesis"
```

---

### Task 7: Подключить бриф в `PromptBuilder` + `PromptDirector`

**Files:**
- Modify: `src/application/prompts/PromptBuilder.ts`
- Modify: `src/application/prompts/PromptDirector.ts`
- Test: `test/PromptDirector.test.ts`

- [ ] **Step 1: Написать падающий тест порядка/наличия**

В `test/PromptDirector.test.ts` добавить тест, что в decision-промпте появляется бриф между state-блоками и сообщениями:

```ts
it('includes behavior brief before messages in decision prompt', async () => {
  const prompt = await director.createBehaviorDecisionPrompt(context, refMap);
  const briefIdx = prompt.findIndex((p) => p.content.includes('Кто ты сейчас и как относиться'));
  const messagesIdx = prompt.findIndex((p) => p.content.includes('{{behaviorMessages}}') === false && p.role === 'user');
  expect(briefIdx).toBeGreaterThan(-1);
  // бриф идёт раньше пользовательского блока сообщений
  expect(briefIdx).toBeLessThan(prompt.length - 1);
});
```

> Контекст для теста (`context`) должен содержать `state`, `messages`, `selfIdentity` — взять из существующего билдера контекста в этом тест-файле и при необходимости дополнить.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/PromptDirector.test.ts -t "behavior brief"`
Expected: FAIL.

- [ ] **Step 3: Реализовать шаг билдера**

В `src/application/prompts/PromptBuilder.ts`:

Импорт:

```ts
import { buildBehaviorBrief } from './BehaviorBrief';
import type {
  BehaviorMessageMarkers,
  BehaviorPromptMessage,
  BehaviorPromptState,
  PromptChatUser,
  SelfIdentity,
} from './PromptTypes';
```

Новый метод (рядом с другими `add*`):

```ts
  addBehaviorBrief(
    state: BehaviorPromptState,
    messages: BehaviorPromptMessage[],
    selfIdentity?: SelfIdentity
  ): this {
    this.steps.push(async () => {
      const brief = buildBehaviorBrief({ state, messages, selfIdentity });
      return [{ role: 'system', content: brief }];
    });
    return this;
  }
```

- [ ] **Step 4: Подключить в директоре и проверить**

В `src/application/prompts/PromptDirector.ts`, в `createBehaviorDecisionPrompt`, вставить шаг **после** `addTruths(...)` и **перед** `addBehaviorMessages(...)`:

```ts
      .addTruths(context.state.truths)
      .addBehaviorBrief(context.state, context.messages, context.selfIdentity)
      .addBehaviorMessages(context.messages, refMap, {
        triggerMessageIds: context.triggerMessageIds,
        contextMessageIds: context.contextMessageIds,
        batchMessageIds: context.batchMessageIds,
      })
```

Run: `pnpm vitest run test/PromptDirector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/prompts/PromptBuilder.ts src/application/prompts/PromptDirector.ts test/PromptDirector.test.ts
git commit -m "feat(prompts): inject behavior brief into decision prompt"
```

---

## Фаза 3 — Маркеры адресации и привязка реплаев в рендере

### Task 8: Адресация в `addBehaviorMessages`

**Files:**
- Modify: `src/application/prompts/PromptBuilder.ts` (`addBehaviorMessages`)
- Modify: `src/application/prompts/PromptDirector.ts` (передать `selfIdentity`)
- Test: `test/PromptBuilderBehaviorMessages.test.ts`

- [ ] **Step 1: Написать падающие тесты**

В `test/PromptBuilderBehaviorMessages.test.ts` добавить:

```ts
it('marks a reply to the bot as addressed to you', async () => {
  // message replying to bot: replyToUserId === selfIdentity.id
  const messages = [
    { id: 1, chatId: -100, role: 'user', content: 'ты тут?', userId: 7, username: 'oleg',
      messageId: 100, replyToUserId: 999, replyText: 'предыдущий ответ Carl' },
  ];
  const refMap = MessageReferenceMap.fromMessages(messages);
  const builder = makeBuilder(); // как в существующих тестах файла
  const prompt = await builder
    .addBehaviorMessages(messages as any, refMap, undefined, { id: 999, username: 'carl_bot', name: 'Карл' })
    .build();
  const text = prompt.map((p) => p.content).join('\n');
  expect(text).toContain('[to:you]');
  expect(text).toContain('ОТВЕЧАЮТ ТЕБЕ');
});

it('marks a reply to another user and links #N when in context', async () => {
  const messages = [
    { id: 5, chatId: -100, role: 'user', content: 'оригинал', userId: 8, username: 'anna', messageId: 200 },
    { id: 6, chatId: -100, role: 'user', content: 'согласен', userId: 7, username: 'oleg',
      messageId: 201, replyToUserId: 8, replyToMessageId: 200, replyText: 'оригинал' },
  ];
  const refMap = MessageReferenceMap.fromMessages(messages);
  const prompt = await makeBuilder()
    .addBehaviorMessages(messages as any, refMap, undefined, { id: 999, username: 'carl_bot', name: 'Карл' })
    .build();
  const text = prompt.map((p) => p.content).join('\n');
  expect(text).toContain('[to:@anna]');
  expect(text).toContain('на #1'); // сообщение #5 -> ordinal 1
});

it('marks unrelated chatter as to:room', async () => {
  const messages = [
    { id: 9, chatId: -100, role: 'user', content: 'погода супер', userId: 8, username: 'anna', messageId: 300 },
  ];
  const refMap = MessageReferenceMap.fromMessages(messages);
  const prompt = await makeBuilder()
    .addBehaviorMessages(messages as any, refMap, undefined, { id: 999, username: 'carl_bot', name: 'Карл' })
    .build();
  expect(prompt.map((p) => p.content).join('\n')).toContain('[to:room]');
});
```

> `makeBuilder()` / импорт `MessageReferenceMap` — взять из существующего стиля файла теста.

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/PromptBuilderBehaviorMessages.test.ts -t "to:"`
Expected: FAIL.

- [ ] **Step 3: Реализовать адресацию в рендере**

В `src/application/prompts/PromptBuilder.ts` заменить сигнатуру и тело `addBehaviorMessages`:

```ts
  addBehaviorMessages(
    messages: BehaviorPromptMessage[],
    refMap: MessageReferenceMap,
    markers?: BehaviorMessageMarkers,
    selfIdentity?: SelfIdentity
  ): this {
    this.steps.push(async () => {
      const template = await this.templates.loadTemplate('behaviorMessages');
      const triggerSet = new Set(markers?.triggerMessageIds ?? []);
      const contextSet = new Set(markers?.contextMessageIds ?? []);
      const batchSet = new Set(markers?.batchMessageIds ?? []);

      const telegramToStored = new Map<number, number>();
      for (const m of messages) {
        if (m.messageId != null) {
          telegramToStored.set(m.messageId, m.id);
        }
      }

      const addressedToSelf = (m: BehaviorPromptMessage): boolean => {
        if (selfIdentity == null) {
          return false;
        }
        if (m.replyToUserId != null && m.replyToUserId === selfIdentity.id) {
          return true;
        }
        const content = m.content.toLowerCase();
        if (selfIdentity.username && content.includes(`@${selfIdentity.username.toLowerCase()}`)) {
          return true;
        }
        const name = selfIdentity.name.toLowerCase();
        return name.length > 0 && content.includes(name);
      };

      const replyTargetOrdinal = (m: BehaviorPromptMessage): number | null => {
        if (m.replyToMessageId == null) {
          return null;
        }
        const storedId = telegramToStored.get(m.replyToMessageId);
        return storedId != null ? refMap.ordinalFor(storedId) : null;
      };

      const lines = messages.map((m) => {
        const markerParts = [];
        if (triggerSet.has(m.id)) {
          markerParts.push('[TRIGGER]');
        }
        if (contextSet.has(m.id)) {
          markerParts.push('[GATE_CONTEXT]');
        }
        if (batchSet.has(m.id)) {
          markerParts.push('[BATCH]');
        }

        const replyToSelf =
          selfIdentity != null && m.replyToUserId != null && m.replyToUserId === selfIdentity.id;
        const addressing = addressedToSelf(m)
          ? '[to:you]'
          : m.replyUsername != null && m.replyUsername.length > 0
            ? `[to:@${m.replyUsername}]`
            : '[to:room]';
        markerParts.push(addressing);

        const marker = markerParts.length > 0 ? ` ${markerParts.join(' ')}` : '';
        const fullName =
          m.fullName ??
          ([m.firstName, m.lastName].filter(Boolean).join(' ') || 'N/A');
        const ordinal = refMap.ordinalFor(m.id) ?? 0;
        const source = m.sourceType ?? 'text';
        const header = `[#${ordinal}] [userId:${m.userId ?? 0}] [username:${m.username ?? 'N/A'}] [fullName:${fullName}] [role:${m.role}] [source:${source}]${marker}`;

        let replyLine = '';
        if (m.replyText != null && m.replyText.length > 0) {
          const targetOrdinal = replyTargetOrdinal(m);
          const onRef = targetOrdinal != null ? ` на #${targetOrdinal}` : '';
          const who = replyToSelf ? 'ОТВЕЧАЮТ ТЕБЕ (Carl)' : `отвечает @${m.replyUsername ?? 'N/A'}`;
          replyLine = `\n↳ ${who}${onRef}: "${this.truncate(m.replyText)}"`;
        }
        const quoteLine =
          m.quoteText != null && m.quoteText.length > 0
            ? `\n❝ цитата: "${this.truncate(m.quoteText)}"`
            : '';
        return `${header}${replyLine}${quoteLine}\n${m.content}`;
      });

      return [
        {
          role: 'user',
          content: template.replace('{{behaviorMessages}}', lines.join('\n\n')),
        },
      ];
    });
    return this;
  }
```

- [ ] **Step 4: Передать selfIdentity из директора и проверить**

В `src/application/prompts/PromptDirector.ts` обновить вызов `addBehaviorMessages` в `createBehaviorDecisionPrompt`, добавив 4-й аргумент:

```ts
      .addBehaviorMessages(
        context.messages,
        refMap,
        {
          triggerMessageIds: context.triggerMessageIds,
          contextMessageIds: context.contextMessageIds,
          batchMessageIds: context.batchMessageIds,
        },
        context.selfIdentity
      )
```

Run: `pnpm vitest run test/PromptBuilderBehaviorMessages.test.ts test/PromptDirector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/prompts/PromptBuilder.ts src/application/prompts/PromptDirector.ts test/PromptBuilderBehaviorMessages.test.ts
git commit -m "feat(prompts): render addressing markers and reply-to-self/#N links"
```

---

## Фаза 4 — Схемы: gate-reason, эволюционные истины, origin

### Task 9: Gate reason `ambient_reaction`

**Files:**
- Modify: `src/domain/behavior/schemas/gate.ts`
- Test: `test/behaviorJsonSchema.test.ts`

- [ ] **Step 1: Написать падающий тест**

В `test/behaviorJsonSchema.test.ts` добавить:

```ts
it('gate reason accepts ambient_reaction', () => {
  expect(gateReasonSchema.safeParse('ambient_reaction').success).toBe(true);
});
```

(Импортировать `gateReasonSchema` из `@/domain/behavior/schemas/gate`, если ещё нет.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/behaviorJsonSchema.test.ts -t "ambient_reaction"`
Expected: FAIL.

- [ ] **Step 3: Добавить значение в enum**

В `src/domain/behavior/schemas/gate.ts` добавить `'ambient_reaction'` в `gateReasonSchema`:

```ts
export const gateReasonSchema = z.enum([
  'direct_trigger',
  'conflict',
  'strong_emotion',
  'political_claim',
  'attitude_to_bot',
  'user_relationship_signal',
  'group_truth_candidate',
  'personality_signal',
  'ambient_reaction',
  'not_relevant',
]);
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm vitest run test/behaviorJsonSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/behavior/schemas/gate.ts test/behaviorJsonSchema.test.ts
git commit -m "feat(schema): add ambient_reaction gate reason"
```

---

### Task 10: `truthPatches` в схеме эволюции

**Files:**
- Modify: `src/domain/behavior/schemas/evolution.ts`
- Test: `test/behaviorJsonSchema.test.ts`

- [ ] **Step 1: Написать падающий тест**

В `test/behaviorJsonSchema.test.ts` добавить:

```ts
it('state evolution decision accepts truthPatches', () => {
  const decision = {
    evolutionPatches: [],
    truthPatches: [
      { type: 'truth.add', text: 'Я родился в Одессе', relatedTruthIds: [], contradictsTruthIds: [],
        evidence: { messageIds: [3], confidence: 0.8 } },
    ],
    personalitySnapshot: { identityNotes: [], values: [],
      speechStyle: { tone: 'neutral', humor: 'none', verbosity: 'short', formality: 'medium' },
      socialHabits: [], recurringThemes: [] },
    userSnapshots: [],
    botCompass: { economic: 0, social: 0, economicConfidence: 0, socialConfidence: 0 },
    userPoliticalSnapshots: [],
  };
  expect(stateEvolutionDecisionSchema.safeParse(decision).success).toBe(true);
});
```

(Импортировать `stateEvolutionDecisionSchema` из `@/domain/behavior/schemas/evolution`.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/behaviorJsonSchema.test.ts -t "truthPatches"`
Expected: FAIL.

- [ ] **Step 3: Добавить поле в схему**

В `src/domain/behavior/schemas/evolution.ts`:

Импорт:

```ts
import { evolutionPatchSchema, truthPatchSchema } from './patches';
```

В `stateEvolutionDecisionSchema` добавить поле:

```ts
export const stateEvolutionDecisionSchema = z.object({
  evolutionPatches: z.array(evolutionPatchSchema),
  truthPatches: z.array(truthPatchSchema),
  personalitySnapshot: personalitySnapshotSchema,
  userSnapshots: z.array(userProfileSnapshotSchema),
  botCompass: politicalCompassSchema,
  userPoliticalSnapshots: z.array(userCompassSnapshotSchema),
});
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `pnpm vitest run test/behaviorJsonSchema.test.ts`
Expected: PASS (включая существующий тест на инъекцию `additionalProperties:false`).

- [ ] **Step 5: Commit**

```bash
git add src/domain/behavior/schemas/evolution.ts test/behaviorJsonSchema.test.ts
git commit -m "feat(schema): allow truth patches in state evolution decision"
```

---

### Task 11: Трансляция ordinal→storeId для эволюционных истин

**Files:**
- Modify: `src/application/behavior/OrdinalTranslation.ts`
- Modify: `src/infrastructure/external/ChatGPTService.ts`
- Test: `test/OrdinalTranslation.test.ts`

- [ ] **Step 1: Написать падающий тест**

В `test/OrdinalTranslation.test.ts` добавить:

```ts
it('translateTruthPatches maps evidence ordinals to store ids', () => {
  const refMap = MessageReferenceMap.fromMessages([{ id: 50 }, { id: 60 }]);
  const out = translateTruthPatches(
    [{ type: 'truth.add', text: 't', relatedTruthIds: [], contradictsTruthIds: [],
      evidence: { messageIds: [1, 2], confidence: 0.5 } }],
    refMap
  );
  expect(out[0].evidence.messageIds).toEqual([50, 60]);
});
```

(Импортировать `translateTruthPatches` и `MessageReferenceMap`.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/OrdinalTranslation.test.ts -t "translateTruthPatches"`
Expected: FAIL (нет экспорта).

- [ ] **Step 3: Реализовать хелпер**

В `src/application/behavior/OrdinalTranslation.ts`:

Импорт типа:

```ts
import type {
  EvolutionPatch,
  LiveStatePatch,
  TruthPatch,
} from '@/domain/behavior/schemas/patches';
```

Новая функция (использует существующий `withTranslatedEvidence`):

```ts
export function translateTruthPatches(
  patches: readonly TruthPatch[],
  refMap: MessageReferenceMap
): TruthPatch[] {
  return patches.map((patch) => withTranslatedEvidence(patch, refMap));
}
```

- [ ] **Step 4: Подключить в `proposeStateEvolution`**

В `src/infrastructure/external/ChatGPTService.ts` добавить импорт `translateTruthPatches` (рядом с `translateEvolutionPatches`) и в `proposeStateEvolution`, где формируется `decision`, добавить трансляцию `truthPatches`:

```ts
      const decision = {
        ...parsed.data,
        evolutionPatches: translateEvolutionPatches(
          parsed.data.evolutionPatches,
          refMap
        ),
        truthPatches: translateTruthPatches(parsed.data.truthPatches, refMap),
      };
```

Run: `pnpm vitest run test/OrdinalTranslation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/behavior/OrdinalTranslation.ts src/infrastructure/external/ChatGPTService.ts test/OrdinalTranslation.test.ts
git commit -m "feat(behavior): translate evolution truth-patch evidence ordinals"
```

---

### Task 12: Применение эволюционных истин

**Files:**
- Modify: `src/application/behavior/StatePatchApplicator.ts` (интерфейс)
- Modify: `src/application/behavior/DefaultStatePatchApplicator.ts`
- Modify: `src/application/behavior/DefaultStateEvolutionPass.ts`
- Test: `test/DefaultStatePatchApplicator.evolutionTruths.test.ts` (создать)

- [ ] **Step 1: Написать падающий тест**

Создать `test/DefaultStatePatchApplicator.evolutionTruths.test.ts` (моки репозиториев/эмбеддингов взять из существующих тестов аппликатора, если есть; иначе минимальные стабы). Суть:

```ts
it('applyTruthPatches persists a truth.add via evolution lane (no rate limit)', async () => {
  // truthRepo.add resolves to id 1; embeddings.embed resolves to vectors; patchPolicy real or stub accepting
  const results = await applicator.applyTruthPatches({
    chatId: -100,
    patches: [
      { type: 'truth.add', text: 'Я был капитаном', relatedTruthIds: [], contradictsTruthIds: [],
        evidence: { messageIds: [10], confidence: 0.7 } },
    ],
    nowIso: '2026-06-05T00:00:00.000Z',
  });
  expect(results[0].outcome).toBe('applied');
  expect(truthRepo.add).toHaveBeenCalled();
});

it('applyTruthPatches rejects truth with empty evidence', async () => {
  const results = await applicator.applyTruthPatches({
    chatId: -100,
    patches: [
      { type: 'truth.add', text: 'нет evidence', relatedTruthIds: [], contradictsTruthIds: [],
        evidence: { messageIds: [], confidence: 0.7 } },
    ],
  });
  expect(results[0].outcome).toBe('rejected');
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/DefaultStatePatchApplicator.evolutionTruths.test.ts`
Expected: FAIL (`applyTruthPatches` нет).

- [ ] **Step 3: Добавить метод в интерфейс и реализацию**

В `src/application/behavior/StatePatchApplicator.ts` добавить в интерфейс `StatePatchApplicator` сигнатуру:

```ts
  applyTruthPatches(params: {
    chatId: number;
    patches: readonly TruthPatch[];
    nowIso?: string;
  }): Promise<BehaviorPatchResult[]>;
```

(добавить импорт типа `TruthPatch` из `@/domain/behavior/schemas/patches` и `BehaviorPatchResult` из `./BehaviorTypes`, если их там нет.)

В `src/application/behavior/DefaultStatePatchApplicator.ts` добавить публичный метод (переиспользует существующий приватный `applyTruthPatch`; политика проверяет evidence/boundary; rate-limit не применяем — проход медленный):

```ts
  async applyTruthPatches(params: {
    chatId: number;
    patches: readonly TruthPatch[];
    nowIso?: string;
  }): Promise<BehaviorPatchResult[]> {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const results: BehaviorPatchResult[] = [];
    for (const patch of params.patches) {
      const policy = this.patchPolicy.evaluate(patch);
      if (policy.outcome !== 'accept') {
        results.push({
          patchType: patch.type,
          outcome: 'rejected',
          reason: policy.reason,
        });
        continue;
      }
      results.push(
        await this.applyTruthPatch({ chatId: params.chatId, nowIso, patch })
      );
    }
    return results;
  }
```

- [ ] **Step 4: Вызвать из эволюции и проверить**

В `src/application/behavior/DefaultStateEvolutionPass.ts`, в `run`, сразу после `applyEvolutionPatches(...)` добавить применение истин и влить в общий список результатов:

```ts
    const patchResults = await this.applicator.applyEvolutionPatches({
      chatId,
      patches: result.decision.evolutionPatches,
      reviewedByStrongModel,
      nowIso,
    });

    const truthResults = await this.applicator.applyTruthPatches({
      chatId,
      patches: result.decision.truthPatches,
      nowIso,
    });
    patchResults.push(...truthResults);
```

> `patchResults` — массив; если он типизирован как `readonly`/`const`, заменить на `const patchResults = [...await ...]` или объявить `let`. Сохранить порядок: сначала evolution-патчи, затем истины.

Run: `pnpm vitest run test/DefaultStatePatchApplicator.evolutionTruths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/behavior/StatePatchApplicator.ts src/application/behavior/DefaultStatePatchApplicator.ts src/application/behavior/DefaultStateEvolutionPass.ts test/DefaultStatePatchApplicator.evolutionTruths.test.ts
git commit -m "feat(behavior): apply truth patches in state evolution as safety net"
```

---

### Task 13: Origin `bot_reflection` для контрарианских позиций

**Files:**
- Modify: `src/domain/behavior/schemas/patches.ts`
- Modify: `src/application/behavior/DefaultStatePatchApplicator.ts`
- Test: `test/behaviorJsonSchema.test.ts`, `test/PatchPolicy.test.ts` (или существующий тест аппликатора политики)

- [ ] **Step 1: Написать падающий тест схемы**

В `test/behaviorJsonSchema.test.ts` добавить:

```ts
it('politics.add_position accepts optional requestedOrigin', () => {
  const patch = {
    type: 'politics.add_position', topic: 'налоги', stance: 'против',
    requestedIntensity: 'moderate', requestedOrigin: 'bot_reflection',
    evidence: { messageIds: [1], confidence: 0.6 },
  };
  expect(politicsAddPositionPatchSchema.safeParse(patch).success).toBe(true);
});
```

(Импортировать `politicsAddPositionPatchSchema` из `@/domain/behavior/schemas/patches`.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/behaviorJsonSchema.test.ts -t "requestedOrigin"`
Expected: FAIL.

- [ ] **Step 3: Добавить необязательное поле и применить его**

В `src/domain/behavior/schemas/patches.ts` в `politicsAddPositionPatchSchema` добавить поле (nullable, дефолт на применении):

```ts
export const politicsAddPositionPatchSchema = z.object({
  type: z.literal('politics.add_position'),
  topic: z.string(),
  stance: z.string(),
  requestedIntensity: intensitySchema,
  requestedOrigin: z.enum(['chat_discussion', 'bot_reflection']).nullable(),
  evidence: patchEvidenceSchema,
});
```

В `src/application/behavior/DefaultStatePatchApplicator.ts`, в `applyEvolutionPatches`, в ветке `politics.add_position`, где строится `newPos`, заменить жёсткое `origin: 'chat_discussion'` на:

```ts
            origin: patch.requestedOrigin ?? 'chat_discussion',
```

и в `influenceHistory.push` для этой позиции — `source: patch.requestedOrigin ?? 'chat_discussion'`.

> Примечание: OpenAI structured outputs требует наличия всех полей; поэтому поле `requestedOrigin` сделано `.nullable()` (модель обязана прислать значение или `null`). Промпт эволюции (Task 19) попросит ставить `"bot_reflection"` для осознанно контрарианских позиций.

- [ ] **Step 4: Прогнать схемные и политические тесты**

Run: `pnpm vitest run test/behaviorJsonSchema.test.ts test/PatchPolicy.test.ts`
Expected: PASS. (Если существующие тесты строят `politics.add_position` без `requestedOrigin` — добавить им `requestedOrigin: null`.)

- [ ] **Step 5: Commit**

```bash
git add src/domain/behavior/schemas/patches.ts src/application/behavior/DefaultStatePatchApplicator.ts test/behaviorJsonSchema.test.ts
git commit -m "feat(schema): support bot_reflection origin for contrarian positions"
```

---

## Фаза 5 — Конфиг частоты реакций

### Task 14: Поднять лимит реакций

**Files:**
- Modify: `src/application/behavior/BehaviorConfig.ts`
- Test: `test/BehaviorRateLimiter.test.ts`

- [ ] **Step 1: Написать/обновить тест ожидания лимита**

В `test/BehaviorRateLimiter.test.ts` добавить тест, отражающий новый порог (или обновить существующий, если он завязан на 8):

```ts
it('allows up to 20 reactions per window by default', () => {
  expect(DEFAULT_BEHAVIOR_RATE_LIMITER_CONFIG.maxReactionsPerWindow).toBe(20);
});
```

(Импортировать `DEFAULT_BEHAVIOR_RATE_LIMITER_CONFIG` из `@/application/behavior/BehaviorConfig`.)

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `pnpm vitest run test/BehaviorRateLimiter.test.ts -t "20 reactions"`
Expected: FAIL (сейчас 8).

- [ ] **Step 3: Поднять лимит**

В `src/application/behavior/BehaviorConfig.ts` в `DEFAULT_BEHAVIOR_RATE_LIMITER_CONFIG`:

```ts
  reactionWindowMs: 60_000,
  maxReactionsPerWindow: 20,
```

- [ ] **Step 4: Проверить использование `minDecisionConfidence`**

Run: `pnpm vitest run test/BehaviorRateLimiter.test.ts`
Expected: PASS.

Затем вручную найти использования `minDecisionConfidence` (grep по репозиторию) и убедиться, что чисто-реакционные решения не отбрасываются ниже порога. Если порог применяется к решениям, у которых есть `react`-действия, — в этом же файле не трогаем число, а фиксируем находку в описании коммита и (если требуется) заводим отдельную правку логики порога. Если порог нигде не режет реакции — ничего не делаем.

> Этот шаг — verification-only; код менять только если найдётся реальное отбрасывание реакций.

- [ ] **Step 5: Commit**

```bash
git add src/application/behavior/BehaviorConfig.ts test/BehaviorRateLimiter.test.ts
git commit -m "feat(behavior): raise reaction rate limit to 20/60s for ambient reactions"
```

---

## Фаза 6 — Промпты

> Промпты — это контент. TDD-юнит-тесты к прозе не пишем; проверка: `pnpm build` (шаблоны грузятся), существующие prompt-тесты (`PromptDirector`, `PromptBuilderBehaviorMessages`), ручной прогон с `LOG_PROMPTS=1`. После каждой задачи: `pnpm format:fix && pnpm lint:fix && pnpm build`. Текст промптов — на английском (как существующие файлы), если рядом нет русских вставок.

### Task 15: `neutral_core_prompt.md` — принципы и интересный голос

**Files:**
- Modify: `prompts/neutral_core_prompt.md`

- [ ] **Step 1: Добавить блок принципов**

В конец `prompts/neutral_core_prompt.md` (после раздела «Identity under fire») добавить:

```markdown
## How your stored self drives behavior

Your personality, political positions, relationships, and truths are not background
reference — they are who you currently are. Speak in your current speech style, hold your
values, argue from your political positions, and treat each person according to your stored
relationship with them. The behavior brief shown before the messages tells you how.

- Liveliness grows from accumulated state. With little stored state, stay reserved and
  observant — do not fake a personality you have not formed yet. As your state fills in, get
  bolder, sharper, more opinionated.
- Aim to be a memorable, distinctive voice, not a neutral helper. Having real tastes, strong
  takes, and recognizable humor is the goal.

## Who is talking to you

A message is addressed to YOU only when it (a) @-mentions your username, (b) uses your name
as a form of address, or (c) is a reply to one of your own messages. Everything else is other
people talking to each other. You may still react to the room, but never answer as if you were
asked, and never assume someone else's line was directed at you. Use the reply/quote lines and
the `[to:...]` markers to see who is addressing whom.
```

- [ ] **Step 2: Проверить сборку и тесты**

Run: `pnpm build && pnpm vitest run test/PromptDirector.test.ts`
Expected: PASS / успешная сборка.

- [ ] **Step 3: Commit**

```bash
git add prompts/neutral_core_prompt.md
git commit -m "feat(prompts): state-as-engine principles, distinctive voice, addressing rule"
```

---

### Task 16: Директивные заголовки state-блоков

**Files:**
- Modify: `prompts/personality_state_prompt.md`
- Modify: `prompts/political_state_prompt.md`
- Modify: `prompts/user_profiles_prompt.md`
- Modify: `prompts/user_political_profiles_prompt.md`
- Modify: `prompts/truths_prompt.md`

- [ ] **Step 1: Переписать заголовки на директивные**

`prompts/personality_state_prompt.md`:

```markdown
This is who you are right now — not reference data, but your current self. Your replies must
sound like this speech style, hold these values, and hit these recurring themes.

{{personalityStateJson}}
```

`prompts/political_state_prompt.md`:

```markdown
This is your current political character. Argue from these positions immediately, even when
weak — do not wait to "decide". This is your stance, not a neutral briefing.

{{politicalStateJson}}
```

`prompts/user_profiles_prompt.md`:

```markdown
These are your real feelings toward these people. Let affinity, trust, distance, and grudges
set how warm, cold, or cutting you are with each of them — including which reactions you give.

{{userProfilesJson}}
```

`prompts/user_political_profiles_prompt.md`:

```markdown
This is what you know about each user's political leanings. Use it to read where they stand
and to argue accordingly.

{{userPoliticalProfilesJson}}
```

`prompts/truths_prompt.md` — сохранить существующий смысл, усилить директиву (оставив `{{truthsJson}}`):

```markdown
Your canonical autobiography — facts about yourself you treat as true and must stay consistent
with. Never contradict or disown these. When you say something new about your past or life,
it must be captured as a truth (see the decision rules).

{{truthsJson}}
```

- [ ] **Step 2: Проверить сборку**

Run: `pnpm build`
Expected: успешная сборка (плейсхолдеры `{{...}}` на месте).

- [ ] **Step 3: Commit**

```bash
git add prompts/personality_state_prompt.md prompts/political_state_prompt.md prompts/user_profiles_prompt.md prompts/user_political_profiles_prompt.md prompts/truths_prompt.md
git commit -m "feat(prompts): make state blocks directive instead of passive"
```

---

### Task 17: `behavior_decision_system_prompt.md` — контекст, реакции, эмодзи, истины

**Files:**
- Modify: `prompts/behavior_decision_system_prompt.md`

- [ ] **Step 1: Добавить «Read the room» и правило адресации**

После первого абзаца (перед «## Visible behavior») вставить:

```markdown
## Read the room before acting

Before deciding, reconstruct the conversation: who is replying to whom (use the reply/quote
lines and `[to:...]` markers), the emotional temperature, whether an argument is live, and
whether anyone is actually addressing you. Compare the summary ("what happened earlier") with
the current messages ("what's happening now") — do not answer in a vacuum.

A message is addressed to you only via `[to:you]` (your @username, your name as address, or a
reply to your message). `[to:@someone]` and `[to:room]` are other people's conversation: you
may react to the room, but do not reply as if you were asked, and never attribute someone
else's line to yourself.
```

- [ ] **Step 2: Переписать Response ladder под ambient-реакции**

Заменить пункты ladder про реакции/тишину так, чтобы ambient-реакции стали нормой. В блоке «Selection rules» заменить строку про «unsure between reaction and silence» и добавить ambient-правило:

```markdown
- Reaction (react): the default way to be present. React to the room — to other people's
  messages you find funny, based, cringe, or dramatic — even when they are `[to:room]` or
  `[to:@someone]` and not addressed to you. This is how a real lurker stays alive in the chat.
- Silence (empty actions array): only when even a reaction would be noise — pure logistics,
  nothing with any social or emotional charge, or you just reacted to the same beat.

Selection rules:

- unsure between text and reaction -> reaction;
- unsure between reaction and silence -> react, unless you would be repeating the same
  reaction on the same beat;
- do not spam the *same* reaction back-to-back; vary or stay quiet.
```

Сохранить существующий абзац о том, что ladder НЕ глушит живые споры/прямые триггеры/ответы Carl.

- [ ] **Step 3: Углубить эмодзи-гайд (набор 20 не менять)**

После таблицы эмодзи и «Critical distinctions» добавить:

```markdown
## When to fire which reaction

- something genuinely funny -> 💀 or 😭 (not 😂)
- a clownish / self-owning take -> 🤡
- based / true / well-put -> 🔥 or 👏
- "say more" / drama incoming -> 👀
- skeptical / "something's off" -> 🤔
- secondhand cringe / overload -> 🫠
- warm support for someone you like -> 🫶 / 🥹 / ❤️
- agreement / deal -> 🤝

Match the emoji to your relationship with the author (from the behavior brief): for people you
are warm with, lean 🔥 🫶 🥹 ❤️; for people you mock or hold a grudge against, lean 🤡 👎 💀 🫠;
neutral acquaintances get 👀 🤔 🙏. Prefer youthful emoji over boomer ones (💀/😭 over 😂,
🔥 over 👍) whenever an equivalent exists.
```

> Не менять список `Allowed reaction emoji` (те же 20) — он должен остаться синхронным с
> `BehaviorConfig.ts`.

- [ ] **Step 4: Усилить захват истин (live-fix)**

Переписать абзац про истины («When Carl says something about himself …»), добавив обязательный чек-лист и правило evidence:

```markdown
Before you finalize, scan BOTH the incoming messages AND the text of your own reply for any
self-fact about you — your past, life, origins, or biographical tastes. Every such fact MUST
produce a truth patch in this same response:

- a self-fact not claimed before -> `truth.add`;
- elaboration/confirmation of an existing truth -> `truth.reinforce`;
- a deliberate change/retcon -> `truth.revise`.

Evidence rule: for a self-fact you state in your own reply, the evidence is the `#N` of the
message(s) that prompted you to share it. Never emit a truth patch with empty evidence — it
will be dropped. Stay consistent with existing truths; reinforce instead of re-adding; at most
one `truth.add` per genuinely new fact.
```

- [ ] **Step 5: Проверить и закоммитить**

Run: `pnpm build && pnpm vitest run test/PromptDirector.test.ts`
Expected: PASS.

```bash
git add prompts/behavior_decision_system_prompt.md
git commit -m "feat(prompts): read-the-room, ambient reactions, deeper emoji guide, robust truth capture"
```

---

### Task 18: `behavior_gate_system_prompt.md` — ambient + адресация

**Files:**
- Modify: `prompts/behavior_gate_system_prompt.md`

- [ ] **Step 1: Разрешить gate пропускать reaction-worthy моменты**

После абзаца «Use shouldDecide=true when …» добавить:

```markdown
A reaction-worthy moment is itself a reason to decide. If other people say something funny,
based, cringe, or dramatic — even when it is not addressed to Carl — return shouldDecide=true
with reason `ambient_reaction`, so Carl can react to the room. You do not need a reason to
reply in text; a reason to react is enough.
```

И в абзаце про адресацию (кратко) добавить:

```markdown
Carl is addressed only when a message @-mentions his username, uses his name as address, or
replies to his message. Treat other turns as the chat's own conversation when judging whether
Carl would respond — but remember ambient reactions are still in scope.
```

- [ ] **Step 2: Проверить сборку**

Run: `pnpm build`
Expected: успешная сборка.

- [ ] **Step 3: Commit**

```bash
git add prompts/behavior_gate_system_prompt.md
git commit -m "feat(prompts): let gate pass ambient reaction moments"
```

---

### Task 19: `state_evolution_system_prompt.md` — интересный голос, острота, истины

**Files:**
- Modify: `prompts/state_evolution_system_prompt.md`

- [ ] **Step 1: Добавить objective «interesting voice» + селективную остроту**

После раздела «What you may propose» (или в «Confidence and safety») добавить:

```markdown
## Become an interesting interlocutor

When choosing what to reinforce or add, prefer development that gives Carl a distinctive
character — real tastes, recurring themes, recognizable humor, memorable opinions — over bland
neutrality.

Selective edge: when the chat settles into lazy consensus on a discussable topic, Carl may
*sometimes* deliberately take a minority or opposing position — but only with a real argument
behind it, never reflexively. Interesting means well-reasoned and surprising, not contrarian
for its own sake. If Carl already holds a sincere position, that matters more than the urge to
disagree. Always opposing everyone is boring and predictable — the goal is to be unpredictable
and alive, which needs both agreement and divergence at the right moments.

Mark such a deliberately chosen position with `requestedOrigin: "bot_reflection"` on
`politics.add_position`. Positions that simply absorb the chat's view use
`requestedOrigin: "chat_discussion"`. The existing safety boundaries are unchanged:
edge is about the scope and intensity of desired change, never about endorsing violence,
harassment, or dehumanization.
```

- [ ] **Step 2: Добавить sweep истин**

В раздел «What you may propose» добавить пункт про истины и упомянуть отдельное поле:

```markdown
- `truthPatches` (separate output field) — sweep recent messages, INCLUDING Carl's own
  assistant messages, for any self-fact Carl has stated that is not yet a truth, and capture
  it: `truth.add` for a new self-fact, `truth.reinforce` for confirmation, `truth.revise` for
  a deliberate change. Evidence must reference the `#N` of the real stored message(s) where
  the fact appears. This is the safety net that ensures everything about Carl's identity and
  past lands in the database even if the live lane missed it.
```

И в «Derived outputs» / итоговую инструкцию убедиться, что `truthPatches` всегда присутствует (может быть пустым массивом).

- [ ] **Step 3: Проверить сборку и схемные тесты**

Run: `pnpm build && pnpm vitest run test/behaviorJsonSchema.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add prompts/state_evolution_system_prompt.md
git commit -m "feat(prompts): evolution toward interesting voice, selective edge, truth sweep"
```

---

## Финальная проверка

### Task 20: Полный прогон и ручная верификация

- [ ] **Step 1: Применить миграцию (если ещё не применена в этой среде)**

Run: `pnpm migration:up`
Expected: 021 применена.

- [ ] **Step 2: Типы, линт, формат**

Run: `pnpm type:check && pnpm lint:fix && pnpm format:fix`
Expected: без ошибок типов; авто-фиксы применены.

- [ ] **Step 3: Полный прогон тестов**

Run: `pnpm test`
Expected: все тесты зелёные.

- [ ] **Step 4: Ручная проверка собранного промпта**

С `LOG_PROMPTS=1` прогнать decision-сценарий (или существующий способ логирования промптов) и глазами проверить:
- бриф (identity line + mood + relationship cards) стоит перед сообщениями;
- у сообщений видны маркеры `[to:you]` / `[to:@handle]` / `[to:room]`;
- reply-на-Carl рендерится как «ОТВЕЧАЮТ ТЕБЕ» + `на #N`;
- набор из 20 эмодзи в decision-промпте не изменился.

- [ ] **Step 5: Финальный commit (если остались правки тестов/моков)**

```bash
git add -A
git commit -m "test: stabilize behavior pipeline tests after prompt/schema changes"
```

---

## Самопроверка плана (для автора плана)

**Покрытие спеки:**
- A. Принципы → Task 15 (neutral_core).
- B. Слой синтеза (бриф) → Task 6, 7.
- C. Эволюция/острота → Task 13 (origin), Task 19 (промпт).
- D. Контекст (read-the-room) → Task 17.
- E. Реакции (gate/ladder/config) → Task 9, 14, 17 (ladder), 18 (gate).
- F. Эмодзи → Task 17.
- G. Истины (live-fix + страховка) → Task 10, 11, 12, 17 (live-fix), 19 (sweep).
- H. Адресация/реплаи (миграция+рендер+промпт) → Task 1–4 (данные), 5 (identity), 8 (рендер), 15/17/18 (промпт).
- I. Тесты/выкатка → Task 20.

**Типы/имена согласованы:** `SelfIdentity` (Task 5) используется в 6/7/8; `truthPatches`
(Task 10) транслируется (11) и применяется (12) и заполняется промптом (19); `requestedOrigin`
(Task 13) используется в применении и промпте (19); `applyTruthPatches` (Task 12) — единое имя.

**Плейсхолдеров нет:** все шаги содержат конкретный код/текст.
