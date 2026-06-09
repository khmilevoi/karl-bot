# Truth Deduplication — Write-Side Embedding Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `bot_truths` from accumulating near-duplicate rows by adding a write-side guard that merges a new `truth.add` into an existing truth when they are semantically near-identical (embedding cosine ≥ threshold).

**Architecture:** A pure `cosineSimilarity` helper + a new `EmbeddingService` (OpenAI `text-embedding-3-small`) feed a dedup guard inside `DefaultStatePatchApplicator`'s `truth.add` branch. Embeddings are stored in a new nullable `bot_truths.embedding_json` column and lazily backfilled for pre-existing active truths. A duplicate becomes a reinforce of the matched truth, reported with a new `merged` patch outcome. Only `truth.add` is guarded; `revise`/`contest` keep their intentional new-row semantics (their rows get embeddings via lazy backfill). The guard is fail-open: any embedding error falls back to a plain insert so a truth is never lost.

**Tech Stack:** TypeScript, Inversify DI, SQLite (`sqlite`/`sqlite3`), OpenAI SDK (`openai` v6), Zod v4, Vitest.

**Deviations from spec (intentional):**
- Migration number is **018** (spec said 017 — that number is already taken by `017_cutover_legacy_cleanup`).
- Embedding model is a module constant (`text-embedding-3-small`) inside the service rather than an env var — YAGNI, avoids editing `Env`/`DefaultEnvService`/`TestEnvService`/`.env.example` for a value that effectively never changes.
- Embedding failures are tolerated silently (fail-open) without logging, to keep the applicator's constructor dependencies unchanged (it has no logger injected today).

---

## File Structure

**Create:**
- `src/application/behavior/cosineSimilarity.ts` — pure cosine helper.
- `src/application/interfaces/ai/EmbeddingService.ts` — `EmbeddingService` interface + `EMBEDDING_SERVICE_ID`.
- `src/infrastructure/external/OpenAIEmbeddingService.ts` — OpenAI-backed implementation.
- `migrations/018_add_truth_embedding.up.sql` / `.down.sql` — add/drop `embedding_json` column.
- `test/cosineSimilarity.test.ts`, `test/OpenAIEmbeddingService.test.ts`, `test/behaviorMigration018.test.ts`, `test/truthRepositoryEmbedding.test.ts`.

**Modify:**
- `src/domain/repositories/TruthRepository.ts` — add `TruthEmbedding`, `findActiveEmbeddings`, `setEmbedding`, optional `embedding` arg on `add`.
- `src/infrastructure/persistence/sqlite/SQLiteTruthRepository.ts` — implement the new methods + store embedding on insert.
- `src/application/behavior/BehaviorTypes.ts` — add `'merged'` to `BehaviorPatchOutcome`.
- `src/application/behavior/StatePatchApplicator.ts` — add `truthDuplicateSimilarity` to config + default.
- `src/application/behavior/DefaultStatePatchApplicator.ts` — inject `EmbeddingService`, rewrite `truth.add` branch with the dedup guard.
- `src/container/application.ts` — bind `EMBEDDING_SERVICE_ID → OpenAIEmbeddingService`.
- `test/StatePatchApplicator.test.ts` — update fakes/config + add dedup tests.

---

## Task 1: Pure cosine similarity helper

**Files:**
- Create: `src/application/behavior/cosineSimilarity.ts`
- Test: `test/cosineSimilarity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/cosineSimilarity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { cosineSimilarity } from '../src/application/behavior/cosineSimilarity';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is scale-invariant', () => {
    expect(cosineSimilarity([1, 0, 0], [5, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 when a vector is all zeros', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('returns 0 for length mismatch or empty input', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/cosineSimilarity.test.ts`
Expected: FAIL — cannot resolve `../src/application/behavior/cosineSimilarity`.

- [ ] **Step 3: Write minimal implementation**

Create `src/application/behavior/cosineSimilarity.ts`:

```ts
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[]
): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/cosineSimilarity.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/application/behavior/cosineSimilarity.ts test/cosineSimilarity.test.ts
git commit -m "feat(behavior): add pure cosineSimilarity helper"
```

---

## Task 2: Migration 018 — `bot_truths.embedding_json`

**Files:**
- Create: `migrations/018_add_truth_embedding.up.sql`
- Create: `migrations/018_add_truth_embedding.down.sql`
- Test: `test/behaviorMigration018.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/behaviorMigration018.test.ts`:

```ts
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

type Db = Awaited<ReturnType<typeof open>>;

let db: Db;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mig018-'));
  db = await open({
    filename: path.join(dir, 't.db'),
    driver: sqlite3.Database,
  });
  await db.exec('CREATE TABLE chats (chat_id INTEGER PRIMARY KEY, title TEXT);');
  const up015 = readFileSync(
    path.join('migrations', '015_create_behavior_tables.up.sql'),
    'utf8'
  );
  await db.exec(up015);
});

describe('migration 018 (truth embedding column)', () => {
  it('adds embedding_json to bot_truths', async () => {
    const up = readFileSync(
      path.join('migrations', '018_add_truth_embedding.up.sql'),
      'utf8'
    );
    await db.exec(up);

    const cols = await db.all<{ name: string }[]>(
      "SELECT name FROM pragma_table_info('bot_truths')"
    );
    expect(cols.map((c) => c.name)).toContain('embedding_json');
  });

  it('down migration removes embedding_json again', async () => {
    const up = readFileSync(
      path.join('migrations', '018_add_truth_embedding.up.sql'),
      'utf8'
    );
    const down = readFileSync(
      path.join('migrations', '018_add_truth_embedding.down.sql'),
      'utf8'
    );
    await db.exec(up);
    await db.exec(down);

    const cols = await db.all<{ name: string }[]>(
      "SELECT name FROM pragma_table_info('bot_truths')"
    );
    expect(cols.map((c) => c.name)).not.toContain('embedding_json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/behaviorMigration018.test.ts`
Expected: FAIL — cannot read `migrations/018_add_truth_embedding.up.sql`.

- [ ] **Step 3: Write the migration files**

Create `migrations/018_add_truth_embedding.up.sql`:

```sql
ALTER TABLE bot_truths ADD COLUMN embedding_json TEXT;
```

Create `migrations/018_add_truth_embedding.down.sql`:

```sql
ALTER TABLE bot_truths DROP COLUMN embedding_json;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/behaviorMigration018.test.ts`
Expected: PASS (2 tests). (SQLite bundled with `sqlite3` supports `ALTER TABLE ... DROP COLUMN`.)

- [ ] **Step 5: Commit**

```bash
git add migrations/018_add_truth_embedding.up.sql migrations/018_add_truth_embedding.down.sql test/behaviorMigration018.test.ts
git commit -m "feat(db): add bot_truths.embedding_json column (migration 018)"
```

---

## Task 3: EmbeddingService interface + OpenAI implementation + DI binding

**Files:**
- Create: `src/application/interfaces/ai/EmbeddingService.ts`
- Create: `src/infrastructure/external/OpenAIEmbeddingService.ts`
- Modify: `src/container/application.ts`
- Test: `test/OpenAIEmbeddingService.test.ts`

- [ ] **Step 1: Write the interface**

Create `src/application/interfaces/ai/EmbeddingService.ts`:

```ts
import type { ServiceIdentifier } from 'inversify';

export interface EmbeddingService {
  // One vector per input text, returned in the same order.
  embed(texts: readonly string[]): Promise<number[][]>;
}

export const EMBEDDING_SERVICE_ID = Symbol.for(
  'EmbeddingService'
) as ServiceIdentifier<EmbeddingService>;
```

- [ ] **Step 2: Write the failing test**

Create `test/OpenAIEmbeddingService.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn(() => ({ embeddings: { create } })),
}));

import type { EnvService } from '../src/application/interfaces/env/EnvService';
import { OpenAIEmbeddingService } from '../src/infrastructure/external/OpenAIEmbeddingService';

function makeEnv(): EnvService {
  return { env: { OPENAI_KEY: 'test-key' } } as unknown as EnvService;
}

beforeEach(() => {
  create.mockReset();
});

describe('OpenAIEmbeddingService', () => {
  it('returns one vector per input text in order', async () => {
    create.mockResolvedValue({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    });
    const service = new OpenAIEmbeddingService(makeEnv());

    const vectors = await service.embed(['a', 'b']);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['a', 'b'],
    });
  });

  it('returns an empty array without calling the API for empty input', async () => {
    const service = new OpenAIEmbeddingService(makeEnv());

    const vectors = await service.embed([]);

    expect(vectors).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test test/OpenAIEmbeddingService.test.ts`
Expected: FAIL — cannot resolve `OpenAIEmbeddingService`.

- [ ] **Step 4: Write the implementation**

Create `src/infrastructure/external/OpenAIEmbeddingService.ts`:

```ts
import { inject, injectable } from 'inversify';
import OpenAI from 'openai';

import type { EmbeddingService } from '@/application/interfaces/ai/EmbeddingService';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';

const EMBEDDING_MODEL = 'text-embedding-3-small';

@injectable()
export class OpenAIEmbeddingService implements EmbeddingService {
  private readonly openai: OpenAI;

  constructor(
    @inject(ENV_SERVICE_ID) private readonly envService: EnvService
  ) {
    this.openai = new OpenAI({ apiKey: this.envService.env.OPENAI_KEY });
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: [...texts],
    });
    return [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test test/OpenAIEmbeddingService.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Bind the service in the container**

In `src/container/application.ts`, add an import near the other infrastructure imports (the `ChatGPTService` import is around line 201):

```ts
import { OpenAIEmbeddingService } from '../infrastructure/external/OpenAIEmbeddingService';
import {
  EMBEDDING_SERVICE_ID,
  type EmbeddingService,
} from '../application/interfaces/ai/EmbeddingService';
```

Then, immediately after the `AIService` binding block (around line 268-271), add:

```ts
  container
    .bind<EmbeddingService>(EMBEDDING_SERVICE_ID)
    .to(OpenAIEmbeddingService)
    .inSingletonScope();
```

- [ ] **Step 7: Verify the project still type-checks and builds**

Run: `pnpm type:check`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/application/interfaces/ai/EmbeddingService.ts src/infrastructure/external/OpenAIEmbeddingService.ts src/container/application.ts test/OpenAIEmbeddingService.test.ts
git commit -m "feat(ai): add OpenAI EmbeddingService and DI binding"
```

---

## Task 4: TruthRepository embedding storage

**Files:**
- Modify: `src/domain/repositories/TruthRepository.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteTruthRepository.ts`
- Test: `test/truthRepositoryEmbedding.test.ts`

- [ ] **Step 1: Extend the repository interface**

Replace the full contents of `src/domain/repositories/TruthRepository.ts` with:

```ts
import type { BotTruth } from '@/domain/behavior/schemas/state';

export type NewTruth = Omit<BotTruth, 'id'>;

export interface TruthEmbedding {
  id: number;
  text: string;
  embedding: number[] | null;
}

export interface TruthRepository {
  add(truth: NewTruth, embedding?: number[] | null): Promise<number>;
  findById(id: number): Promise<BotTruth | undefined>;
  findByChatId(chatId: number): Promise<BotTruth[]>;
  update(truth: BotTruth): Promise<void>;
  findActiveEmbeddings(chatId: number): Promise<TruthEmbedding[]>;
  setEmbedding(id: number, embedding: number[]): Promise<void>;
}

export const TRUTH_REPOSITORY_ID = Symbol('TruthRepository');
```

- [ ] **Step 2: Write the failing test**

Create `test/truthRepositoryEmbedding.test.ts`:

```ts
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  DbProvider,
  SqlDatabase,
} from '../src/domain/repositories/DbProvider';
import { SQLiteTruthRepository } from '../src/infrastructure/persistence/sqlite/SQLiteTruthRepository';

let repo: SQLiteTruthRepository;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'truth-emb-'));
  const db = await open({
    filename: path.join(dir, 't.db'),
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE bot_truths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      source_message_ids_json TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0,
      related_truth_ids_json TEXT NOT NULL DEFAULT '[]',
      contradicts_truth_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'fresh',
      created_at TEXT NOT NULL,
      embedding_json TEXT
    );
  `);
  const provider: DbProvider = {
    get: () => Promise.resolve(db as unknown as SqlDatabase),
    listTables: () => Promise.resolve([]),
  };
  repo = new SQLiteTruthRepository(provider);
});

function newTruth(overrides: Partial<{ text: string; status: string }> = {}) {
  return {
    chatId: 1,
    text: overrides.text ?? 'a truth',
    sourceMessageIds: [1],
    confidence: 0.5,
    relatedTruthIds: [],
    contradictsTruthIds: [],
    status: (overrides.status ?? 'fresh') as
      | 'fresh'
      | 'stable'
      | 'contested'
      | 'superseded',
    createdAt: 'now',
  };
}

describe('SQLiteTruthRepository embeddings', () => {
  it('stores and reads back an embedding passed to add', async () => {
    const id = await repo.add(newTruth(), [0.1, 0.2, 0.3]);

    const rows = await repo.findActiveEmbeddings(1);
    expect(rows).toEqual([{ id, text: 'a truth', embedding: [0.1, 0.2, 0.3] }]);
  });

  it('returns null embedding when none was provided', async () => {
    await repo.add(newTruth());

    const rows = await repo.findActiveEmbeddings(1);
    expect(rows[0].embedding).toBeNull();
  });

  it('setEmbedding backfills a missing embedding', async () => {
    const id = await repo.add(newTruth());

    await repo.setEmbedding(id, [1, 0, 0]);

    const rows = await repo.findActiveEmbeddings(1);
    expect(rows[0].embedding).toEqual([1, 0, 0]);
  });

  it('findActiveEmbeddings excludes superseded truths', async () => {
    await repo.add(newTruth({ text: 'active' }));
    await repo.add(newTruth({ text: 'gone', status: 'superseded' }));

    const rows = await repo.findActiveEmbeddings(1);
    expect(rows.map((r) => r.text)).toEqual(['active']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test test/truthRepositoryEmbedding.test.ts`
Expected: FAIL — `repo.findActiveEmbeddings is not a function` (and `add` ignores the embedding arg).

- [ ] **Step 4: Implement the new repository behavior**

Replace the full contents of `src/infrastructure/persistence/sqlite/SQLiteTruthRepository.ts` with:

```ts
import { inject, injectable } from 'inversify';

import { type BotTruth, botTruthSchema } from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type {
  NewTruth,
  TruthEmbedding,
  TruthRepository,
} from '@/domain/repositories/TruthRepository';

interface TruthRow {
  id: number;
  chat_id: number;
  text: string;
  source_message_ids_json: string;
  confidence: number;
  related_truth_ids_json: string;
  contradicts_truth_ids_json: string;
  status: string;
  created_at: string;
}

interface TruthEmbeddingRow {
  id: number;
  text: string;
  embedding_json: string | null;
}

function toTruth(row: TruthRow): BotTruth {
  return botTruthSchema.parse({
    id: row.id,
    chatId: row.chat_id,
    text: row.text,
    sourceMessageIds: JSON.parse(row.source_message_ids_json),
    confidence: row.confidence,
    relatedTruthIds: JSON.parse(row.related_truth_ids_json),
    contradictsTruthIds: JSON.parse(row.contradicts_truth_ids_json),
    status: row.status,
    createdAt: row.created_at,
  });
}

@injectable()
export class SQLiteTruthRepository implements TruthRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async add(truth: NewTruth, embedding?: number[] | null): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `INSERT INTO bot_truths
        (chat_id, text, source_message_ids_json, confidence, related_truth_ids_json, contradicts_truth_ids_json, status, created_at, embedding_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      truth.chatId,
      truth.text,
      JSON.stringify(truth.sourceMessageIds),
      truth.confidence,
      JSON.stringify(truth.relatedTruthIds),
      JSON.stringify(truth.contradictsTruthIds),
      truth.status,
      truth.createdAt,
      embedding == null ? null : JSON.stringify(embedding)
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async findById(id: number): Promise<BotTruth | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<TruthRow>(
      'SELECT * FROM bot_truths WHERE id = ?',
      id
    );
    return row ? toTruth(row) : undefined;
  }

  async findByChatId(chatId: number): Promise<BotTruth[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<TruthRow>(
      'SELECT * FROM bot_truths WHERE chat_id = ? ORDER BY id',
      chatId
    );
    return rows.map(toTruth);
  }

  async update(truth: BotTruth): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `UPDATE bot_truths SET
        text=?, source_message_ids_json=?, confidence=?, related_truth_ids_json=?, contradicts_truth_ids_json=?, status=?
       WHERE id = ?`,
      truth.text,
      JSON.stringify(truth.sourceMessageIds),
      truth.confidence,
      JSON.stringify(truth.relatedTruthIds),
      JSON.stringify(truth.contradictsTruthIds),
      truth.status,
      truth.id
    );
  }

  async findActiveEmbeddings(chatId: number): Promise<TruthEmbedding[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<TruthEmbeddingRow>(
      `SELECT id, text, embedding_json
       FROM bot_truths
       WHERE chat_id = ? AND status != 'superseded'
       ORDER BY id`,
      chatId
    );
    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      embedding:
        row.embedding_json == null ? null : JSON.parse(row.embedding_json),
    }));
  }

  async setEmbedding(id: number, embedding: number[]): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      'UPDATE bot_truths SET embedding_json = ? WHERE id = ?',
      JSON.stringify(embedding),
      id
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test test/truthRepositoryEmbedding.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verify type-check**

Run: `pnpm type:check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/domain/repositories/TruthRepository.ts src/infrastructure/persistence/sqlite/SQLiteTruthRepository.ts test/truthRepositoryEmbedding.test.ts
git commit -m "feat(db): persist and query truth embeddings"
```

---

## Task 5: Add `merged` patch outcome

**Files:**
- Modify: `src/application/behavior/BehaviorTypes.ts:78-84`

- [ ] **Step 1: Add the outcome to the union**

In `src/application/behavior/BehaviorTypes.ts`, change the `BehaviorPatchOutcome` union to include `'merged'`:

```ts
export type BehaviorPatchOutcome =
  | 'applied'
  | 'merged'
  | 'rejected'
  | 'rate_limited'
  | 'failed'
  | 'escalated'
  | 'to_uncertainty';
```

- [ ] **Step 2: Verify nothing else needs updating**

Run: `pnpm type:check`
Expected: no errors. (`BehaviorPatchResult.outcome` is only consumed by `DefaultBehaviorEventLogger`, which `JSON.stringify`s patch results — no exhaustive `switch` on this union exists.)

- [ ] **Step 3: Commit**

```bash
git add src/application/behavior/BehaviorTypes.ts
git commit -m "feat(behavior): add 'merged' patch outcome"
```

---

## Task 6: Add `truthDuplicateSimilarity` config

**Files:**
- Modify: `src/application/behavior/StatePatchApplicator.ts:11-18`

- [ ] **Step 1: Extend the config interface and default**

In `src/application/behavior/StatePatchApplicator.ts`, update the config interface and its default constant:

```ts
export interface StatePatchApplicatorConfig {
  truthStableConfidence: number;
  truthDuplicateSimilarity: number;
}

export const DEFAULT_STATE_PATCH_APPLICATOR_CONFIG: StatePatchApplicatorConfig =
  {
    truthStableConfidence: 0.75,
    truthDuplicateSimilarity: 0.9,
  };
```

- [ ] **Step 2: Verify type-check**

Run: `pnpm type:check`
Expected: no errors (the container binds `DEFAULT_STATE_PATCH_APPLICATOR_CONFIG`, which now carries the new field).

- [ ] **Step 3: Commit**

```bash
git add src/application/behavior/StatePatchApplicator.ts
git commit -m "feat(behavior): add truthDuplicateSimilarity threshold to applicator config"
```

---

## Task 7: Dedup guard in DefaultStatePatchApplicator

**Files:**
- Modify: `src/application/behavior/DefaultStatePatchApplicator.ts`
- Modify: `test/StatePatchApplicator.test.ts`

This is the core task. The guard runs only for `truth.add`. `truth.reinforce`/`truth.contest`/`truth.revise` are unchanged.

- [ ] **Step 1: Update the existing test harness for the new constructor + repo shape**

In `test/StatePatchApplicator.test.ts`, make four edits.

(a) Add an `EmbeddingService` import at the top, next to the other type imports:

```ts
import type { EmbeddingService } from '../src/application/interfaces/ai/EmbeddingService';
```

(b) Update the shared `config` object (currently only `truthStableConfidence`) to include the new threshold:

```ts
const config: StatePatchApplicatorConfig = {
  truthStableConfidence: 0.75,
  truthDuplicateSimilarity: 0.9,
};
```

(c) Replace the `makeRepos` function so the truth fake stores embeddings separately and implements the two new methods. Replace the whole `const truthRepo: TruthRepository = { ... };` block and the surrounding embedding bookkeeping with:

```ts
  const truths = new Map<number, BotTruth>();
  const embeddings = new Map<number, number[] | null>();
  for (const truth of params?.truths ?? []) {
    truths.set(truth.id, truth);
    embeddings.set(truth.id, null);
  }
  let nextTruthId = Math.max(0, ...truths.keys()) + 1;

  const profileRepo: UserSocialProfileRepository = {
    findByChatAndUser: vi.fn((chatId: number, userId: number) =>
      Promise.resolve(profiles.get(`${chatId}:${userId}`))
    ),
    findByChat: vi.fn(),
    upsert: vi.fn((profile: UserSocialProfile) => {
      profiles.set(`${profile.chatId}:${profile.userId}`, profile);
      return Promise.resolve();
    }),
  };

  const truthRepo: TruthRepository = {
    add: vi.fn((truth, embedding?: number[] | null) => {
      const id = nextTruthId;
      nextTruthId += 1;
      truths.set(id, { id, ...truth });
      embeddings.set(id, embedding ?? null);
      return Promise.resolve(id);
    }),
    findById: vi.fn((id: number) => Promise.resolve(truths.get(id))),
    findByChatId: vi.fn((chatId: number) =>
      Promise.resolve([...truths.values()].filter((t) => t.chatId === chatId))
    ),
    update: vi.fn((truth: BotTruth) => {
      truths.set(truth.id, truth);
      return Promise.resolve();
    }),
    findActiveEmbeddings: vi.fn((chatId: number) =>
      Promise.resolve(
        [...truths.values()]
          .filter((t) => t.chatId === chatId && t.status !== 'superseded')
          .map((t) => ({
            id: t.id,
            text: t.text,
            embedding: embeddings.get(t.id) ?? null,
          }))
      )
    ),
    setEmbedding: vi.fn((id: number, embedding: number[]) => {
      embeddings.set(id, embedding);
      return Promise.resolve();
    }),
  };

  return { profileRepo, profiles, truthRepo, truths, embeddings };
```

Note: `TruthRepository` and `TruthEmbedding` are already imported via the existing
`import type { TruthRepository } from '../src/domain/repositories/TruthRepository';`
line — extend it to also import the type used below if needed (not required here).

(d) Add an embeddings-fake factory and route it into `makeApplicator`. Add this factory above `makeApplicator`:

```ts
// Deterministic, collision-free fake: each distinct unmapped text gets a fresh
// one-hot dimension, so different texts are orthogonal (cosine 0) and the same
// text is identical (cosine 1). Texts present in `map` use the explicit vector.
function makeEmbeddings(map: Record<string, number[]> = {}): EmbeddingService {
  const assigned = new Map<string, number[]>();
  let nextDim = 0;
  const vectorFor = (text: string): number[] => {
    if (map[text]) {
      return map[text];
    }
    const existing = assigned.get(text);
    if (existing) {
      return existing;
    }
    const vector = new Array<number>(256).fill(0);
    vector[nextDim] = 1;
    nextDim += 1;
    assigned.set(text, vector);
    return vector;
  };
  return {
    embed: vi.fn((texts: readonly string[]) =>
      Promise.resolve(texts.map(vectorFor))
    ),
  };
}
```

Then change `makeApplicator` to accept and pass the embeddings fake (append the
three evolution repos as `undefined` — they are unused by `applyPatches` and the
test directory is excluded from `type:check`):

```ts
function makeApplicator(params?: {
  profileRepo?: UserSocialProfileRepository;
  truthRepo?: TruthRepository;
  policy?: PatchPolicy;
  limiter?: BehaviorRateLimiter;
  embeddings?: EmbeddingService;
}) {
  const repos = makeRepos();
  return new DefaultStatePatchApplicator(
    config,
    params?.profileRepo ?? repos.profileRepo,
    params?.truthRepo ?? repos.truthRepo,
    params?.policy ?? acceptingPolicy,
    params?.limiter ?? allowingLimiter,
    undefined as never,
    undefined as never,
    undefined as never,
    params?.embeddings ?? makeEmbeddings()
  );
}
```

- [ ] **Step 2: Run the existing suite to confirm it still passes against current code**

Run: `pnpm test test/StatePatchApplicator.test.ts`
Expected: FAIL to compile/run — `DefaultStatePatchApplicator` does not yet accept a 9th argument / `findActiveEmbeddings` unused. This is expected; the implementation lands in Step 4. (If it happens to pass because the 9th arg is ignored, that's fine too — proceed.)

- [ ] **Step 3: Add the failing dedup tests**

Append these test cases inside the top-level `describe('DefaultStatePatchApplicator', ...)` block in `test/StatePatchApplicator.test.ts`:

```ts
  it('merges a near-duplicate truth.add into the existing truth instead of inserting', async () => {
    const existing = makeTruth({
      id: 10,
      text: 'Carl is from the north of Russia.',
      confidence: 0.8,
      sourceMessageIds: [1],
      status: 'stable',
    });
    const { profileRepo, truthRepo, truths } = makeRepos({ truths: [existing] });
    const shared = [1, 0, 0];
    const embeddings = makeEmbeddings({
      'Carl is from the north of Russia.': shared,
      'Carl is from Russia, specifically the north.': shared,
    });
    const applicator = makeApplicator({ profileRepo, truthRepo, embeddings });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl is from Russia, specifically the north.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([2], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results[0].outcome).toBe('merged');
    expect(results[0].stateRef).toMatchObject({ kind: 'bot_truth', truthId: 10 });
    expect(truthRepo.add).not.toHaveBeenCalled();
    const merged = truths.get(10);
    expect(merged?.sourceMessageIds).toEqual([1, 2]);
    expect(merged?.confidence).toBeCloseTo(0.98);
    expect(merged?.status).toBe('stable');
    expect(truths.size).toBe(1);
  });

  it('inserts a new truth when no existing truth is similar enough', async () => {
    const existing = makeTruth({
      id: 10,
      text: 'Carl likes fixing radios.',
      status: 'stable',
    });
    const { profileRepo, truthRepo, truths } = makeRepos({ truths: [existing] });
    const applicator = makeApplicator({ profileRepo, truthRepo });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl was promoted to OpenAI usage tier 2.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([3], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results[0].outcome).toBe('applied');
    expect(truthRepo.add).toHaveBeenCalledTimes(1);
    expect(truths.size).toBe(2);
  });

  it('does not merge into a truth the add explicitly contradicts', async () => {
    const existing = makeTruth({
      id: 10,
      text: 'Carl was born in Poland.',
      status: 'stable',
    });
    const { profileRepo, truthRepo, truths } = makeRepos({ truths: [existing] });
    const shared = [1, 0, 0];
    const embeddings = makeEmbeddings({
      'Carl was born in Poland.': shared,
      'Carl was born in Russia, not Poland.': shared,
    });
    const applicator = makeApplicator({ profileRepo, truthRepo, embeddings });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl was born in Russia, not Poland.',
          relatedTruthIds: [],
          contradictsTruthIds: [10],
          evidence: evidence([4], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results[0].outcome).toBe('applied');
    expect(truthRepo.add).toHaveBeenCalledTimes(1);
    expect(truths.size).toBe(2);
  });

  it('falls open to a plain insert when the embedding service fails', async () => {
    const { profileRepo, truthRepo, truths } = makeRepos();
    const embeddings: EmbeddingService = {
      embed: vi.fn(() => Promise.reject(new Error('embeddings down'))),
    };
    const applicator = makeApplicator({ profileRepo, truthRepo, embeddings });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl owns a cat.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([5], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results[0].outcome).toBe('applied');
    expect(truthRepo.add).toHaveBeenCalledTimes(1);
    expect(truths.size).toBe(1);
  });

  it('dedups a second identical truth.add within the same batch', async () => {
    const { profileRepo, truthRepo, truths } = makeRepos();
    const shared = [1, 0, 0];
    const embeddings = makeEmbeddings({ 'Carl hates Mondays.': shared });
    const applicator = makeApplicator({ profileRepo, truthRepo, embeddings });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl hates Mondays.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([6], 0.9),
        },
        {
          type: 'truth.add',
          text: 'Carl hates Mondays.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([7], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results.map((r) => r.outcome)).toEqual(['applied', 'merged']);
    expect(truths.size).toBe(1);
    expect([...truths.values()][0].sourceMessageIds).toEqual([6, 7]);
  });
```

Also update the **existing** test `applies truth add, reinforce, contest, and revise semantics`: the `truth.add` text `'new stable truth'` is unrelated to the seeded `'old truth'`, so `oneHot` makes them orthogonal and the add still inserts as id 11 — no change to its assertions is needed. Re-run it in Step 5 to confirm.

- [ ] **Step 4: Implement the guard**

In `src/application/behavior/DefaultStatePatchApplicator.ts`:

(a) Add imports near the other imports:

```ts
import {
  EMBEDDING_SERVICE_ID,
  type EmbeddingService,
} from '@/application/interfaces/ai/EmbeddingService';
import type { TruthEmbedding } from '@/domain/repositories/TruthRepository';

import { cosineSimilarity } from './cosineSimilarity';
```

(b) Add a 9th constructor parameter (append after `userPoliticalRepo`):

```ts
    @inject(USER_POLITICAL_PROFILE_REPOSITORY_ID)
    private readonly userPoliticalRepo: UserPoliticalProfileRepository,
    @inject(EMBEDDING_SERVICE_ID)
    private readonly embeddings: EmbeddingService
  ) {}
```

(c) Replace the `case 'truth.add'` block inside `applyTruthPatch` (currently lines ~282-294) with a delegation to a new method:

```ts
      case 'truth.add': {
        return this.applyTruthAdd(chatId, nowIso, patch);
      }
```

(d) Add these private methods to the class (place them next to `applyTruthPatch`):

```ts
  private async applyTruthAdd(
    chatId: number,
    nowIso: string,
    patch: Extract<TruthPatch, { type: 'truth.add' }>
  ): Promise<BehaviorPatchResult> {
    const dedup = await this.findDuplicateTruth(chatId, patch);

    if (dedup) {
      const target = await this.findMutableTruth(chatId, dedup.id);
      if (target) {
        target.sourceMessageIds = this.uniqueIds([
          ...target.sourceMessageIds,
          ...patch.evidence.messageIds,
        ]);
        target.confidence = this.clampConfidence(
          target.confidence + 0.2 * patch.evidence.confidence
        );
        target.status = this.truthStatus(target.confidence);
        target.relatedTruthIds = this.uniqueIds([
          ...target.relatedTruthIds,
          ...patch.relatedTruthIds,
        ]);
        target.contradictsTruthIds = this.uniqueIds([
          ...target.contradictsTruthIds,
          ...patch.contradictsTruthIds,
        ]);
        await this.truthRepo.update(target);
        return {
          patchType: 'truth.add',
          outcome: 'merged',
          reason: `deduped into #${target.id}`,
          stateRef: { kind: 'bot_truth', chatId, truthId: target.id },
        };
      }
    }

    const id = await this.truthRepo.add(
      {
        chatId,
        text: patch.text,
        sourceMessageIds: this.uniqueIds(patch.evidence.messageIds),
        confidence: this.clampConfidence(patch.evidence.confidence),
        relatedTruthIds: this.uniqueIds(patch.relatedTruthIds),
        contradictsTruthIds: this.uniqueIds(patch.contradictsTruthIds),
        status: this.truthStatus(patch.evidence.confidence),
        createdAt: nowIso,
      },
      dedup?.newVector ?? null
    );
    return this.appliedTruth('truth.add', chatId, id);
  }

  // Returns the best matching existing truth (and the freshly computed vector
  // for the new text) when similarity clears the threshold. Fail-open: any
  // embedding error yields null so the caller performs a plain insert.
  private async findDuplicateTruth(
    chatId: number,
    patch: Extract<TruthPatch, { type: 'truth.add' }>
  ): Promise<{ id: number; newVector: number[] } | { newVector: number[] } | null> {
    let candidates: TruthEmbedding[];
    let newVector: number[];
    try {
      candidates = await this.loadDedupCandidates(chatId);
      [newVector] = await this.embeddings.embed([patch.text]);
    } catch {
      return null;
    }
    if (!newVector) {
      return null;
    }

    const exclude = new Set(patch.contradictsTruthIds);
    let best: { id: number; similarity: number } | null = null;
    for (const candidate of candidates) {
      if (exclude.has(candidate.id) || candidate.embedding === null) {
        continue;
      }
      const similarity = cosineSimilarity(newVector, candidate.embedding);
      if (best === null || similarity > best.similarity) {
        best = { id: candidate.id, similarity };
      }
    }

    if (best !== null && best.similarity >= this.config.truthDuplicateSimilarity) {
      return { id: best.id, newVector };
    }
    return { newVector };
  }

  // Loads non-superseded truths with their embeddings, lazily backfilling any
  // that have none so future adds have something to compare against.
  private async loadDedupCandidates(
    chatId: number
  ): Promise<TruthEmbedding[]> {
    const rows = await this.truthRepo.findActiveEmbeddings(chatId);
    const missing = rows.filter((row) => row.embedding === null);
    if (missing.length > 0) {
      const vectors = await this.embeddings.embed(
        missing.map((row) => row.text)
      );
      await Promise.all(
        missing.map((row, index) => {
          row.embedding = vectors[index];
          return this.truthRepo.setEmbedding(row.id, vectors[index]);
        })
      );
    }
    return rows;
  }
```

Note on the `findDuplicateTruth` return type: the caller reads `dedup.id`
(present only on a match) and `dedup.newVector` (present whenever embedding
succeeded). When there is no match but the vector was computed, it returns
`{ newVector }` so the inserted row still stores its embedding. The
`'id' in dedup` distinction is handled implicitly: `dedup.id` is accessed after
checking `findMutableTruth`, and `dedup?.newVector` is read for the insert.

Adjust the merge branch guard so TypeScript narrows correctly — replace the
`if (dedup) { const target = ... }` opener with an explicit `id` check:

```ts
    if (dedup && 'id' in dedup) {
      const target = await this.findMutableTruth(chatId, dedup.id);
```

- [ ] **Step 5: Run the applicator suite**

Run: `pnpm test test/StatePatchApplicator.test.ts`
Expected: PASS — original cases plus the five new dedup cases (merge, insert-below-threshold, contradiction-excluded, fail-open, intra-batch).

- [ ] **Step 6: Type-check**

Run: `pnpm type:check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/application/behavior/DefaultStatePatchApplicator.ts test/StatePatchApplicator.test.ts
git commit -m "feat(behavior): dedup truth.add via embedding similarity guard"
```

---

## Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: all tests pass, including `container.behavior.test.ts` (the new `EMBEDDING_SERVICE_ID` binding resolves `DefaultStatePatchApplicator`'s 9th dependency).

Note: `test/StatePatchApplicatorEvolution.test.ts` constructs `DefaultStatePatchApplicator` with 8 positional args and exercises only `applyEvolutionPatches`, which never touches `this.embeddings`. The 9th constructor arg is therefore `undefined` there at runtime, which is harmless — **do not** modify that file.

- [ ] **Step 2: Type-check, lint, format**

Run: `pnpm type:check`
Expected: no errors.

Run: `pnpm lint:fix`
Expected: no remaining violations.

Run: `pnpm format:fix`
Expected: formatting applied/clean.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: RSBuild build succeeds.

- [ ] **Step 4: Commit any lint/format fixups**

```bash
git add -A
git commit -m "chore: lint/format fixups for truth dedup guard"
```

(If nothing changed, skip the commit.)

---

## Self-Review Notes

- **Spec coverage:** guard in `truth.add` (Task 7) ✓; embeddings detection + storage (Tasks 3, 4) ✓; column + lazy backfill (Tasks 2, 7 `loadDedupCandidates`) ✓; `merged` outcome (Task 5) ✓; threshold config (Task 6) ✓; fail-open (Task 7 `findDuplicateTruth`/`loadDedupCandidates` try/catch) ✓; contradiction exclusion (Task 7) ✓; intra-batch dedup via per-add fresh `findActiveEmbeddings` (Task 7 test) ✓; no migration of existing rows ✓; `revise`/`contest` untouched, embeddings via lazy backfill ✓.
- **Type consistency:** `findActiveEmbeddings`/`setEmbedding`/`add(truth, embedding?)`/`TruthEmbedding` are defined in Task 4 and consumed verbatim in Task 7; `truthDuplicateSimilarity` defined in Task 6 and read in Task 7; `EMBEDDING_SERVICE_ID`/`EmbeddingService` defined in Task 3 and injected in Task 7; `'merged'` defined in Task 5 and returned in Task 7.
- **No placeholders:** every code/step block contains concrete content and exact commands.
```
