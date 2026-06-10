# Truth Deduplication — Write-Side Embedding Guard

**Date:** 2026-06-01
**Status:** Design (approved decisions captured; pending user spec review)

## Problem

Carl's canonical "truths" (`bot_truths`) accumulate near-duplicate rows. Example
from production data (chat `-1002588658064`):

- #5 `"Carl is from Russia, specifically from the north."` — `stable`
- #7 `"Carl is from Russia, specifically from the north, and treats that origin as part of his canonical biography."` — `stable`, `relatedTruthIds=[5]`

Both remain active and say the same thing. Same pattern for #8/#10 (tier
promotion) and #9/#16 (does not read photos).

### Root cause

Deduplication is **fully delegated to the LLM** and unguarded by code. Write path:

`truth.add` → `DefaultStatePatchApplicator.applyTruthPatch` (`case 'truth.add'`)
→ `SQLiteTruthRepository.add` → **blind `INSERT`**.

There is no similarity check, no unique key, no merge. The only thing meant to
prevent duplicates is a prompt instruction
(`prompts/behavior_decision_system_prompt.md`, "check current truths, use
`truth.reinforce`"). The model ignores it and re-emits `truth.add` — sometimes
even linking the original via `relatedTruthIds` while still creating a new row.

Two drivers feed the same symptom:

1. **LLM re-add instead of reinforce.** The model creates a paraphrased copy of
   a fact it already established (#7 linked `[5]` yet still added).
2. **Reprocessing overlapping message windows.** `sourceMessageIds` overlap
   across duplicate rows (#5∩#7 = `133,134,141,149`; #8∩#10 = `180`), i.e. the
   same fact is re-extracted across passes whose source sets overlap. This ties
   to the known cursor-leapfrog / self-trigger issue
   (`memory/behavior-pipeline-audit-2026-05-31`).

Aggravating factor: **all** truths (including `superseded`) are serialized into
the decision prompt (`PromptBuilder.addTruths`), adding noise that can provoke
re-adds.

The correct flow already works when the model picks the right patch: #1↔#2 and
#14↔#15 are proper `truth.revise` (old → `superseded`, new → active, two-way
link). The gap is solely that `truth.add` has no safety net.

## Goal & Scope

A **write-side guard** that prevents new duplicate truths. Detection by
**semantic embedding similarity** (duplicates here are paraphrases, not exact
text). A detected duplicate is **merged** into the existing truth instead of
inserted.

**In scope**
- Guard inside `applyTruthPatch` for `truth.add` only.
- Embedding service (new) + embedding storage on `bot_truths`.
- New patch outcome `merged`.

**Out of scope (deliberately)**
- Migrating / cleaning the duplicate rows already in the DB (user decision:
  prevent new only). Rows are not modified or merged retroactively.
- Fixing cursor-leapfrog / self-trigger. The guard catches a duplicate
  regardless of *why* the model re-sent the fact, so this fix is unnecessary
  for the symptom and stays tracked separately.
- `truth.revise` / `truth.contest`: these intentionally create new rows
  (supersede / counter). Not guarded. They still get an embedding stored on
  insert so future adds can be compared against them.

## Approach (chosen)

Embedding stored as a nullable JSON column on `bot_truths`, with **lazy
backfill**: when the guard loads active truths and one lacks a vector, it
computes and persists it then. This is not "cleaning duplicates" — rows are
untouched; only the missing vector is filled so new adds have something to
compare against. Rejected alternatives: a separate `truth_embeddings` table
(needless 1:1 join) and recompute-every-time (cost/latency scales with truth
count).

## Components

### 1. EmbeddingService (new)

`src/application/interfaces/ai/EmbeddingService.ts`

```ts
export interface EmbeddingService {
  // Batched: one text -> one vector, in order.
  embed(texts: readonly string[]): Promise<number[][]>;
}
export const EMBEDDING_SERVICE_ID = Symbol.for('EmbeddingService');
```

`src/infrastructure/external/OpenAIEmbeddingService.ts` — wraps the OpenAI
`embeddings.create` API, model `text-embedding-3-small`, reusing the API key via
`EnvService` (same pattern as `ChatGPTService`). Single batched request for the
backfill array.

### 2. Embedding storage

Migration `017_add_truth_embedding`:
- up: `ALTER TABLE bot_truths ADD COLUMN embedding_json TEXT;` (nullable)
- down: `ALTER TABLE bot_truths DROP COLUMN embedding_json;` (SQLite ≥ 3.35,
  bundled with better-sqlite3)

`TruthRepository` (interface + `SQLiteTruthRepository`):
- The vector is **kept out of the domain `BotTruth`** so it never leaks into the
  prompt via `PromptBuilder.addTruths` (a 1536-float array per truth would blow
  up tokens). Access via dedicated methods:
  - `findActiveEmbeddings(chatId): Promise<TruthEmbedding[]>` where
    `TruthEmbedding = { id: number; text: string; embedding: number[] | null }`,
    `active` = status ≠ `superseded`.
  - `setEmbedding(id: number, embedding: number[]): Promise<void>`.
- `add(truth, embedding?: number[] | null)` gains an optional embedding param
  (default null) so inserts from `add`/`revise`/`contest` persist a vector.

### 3. Config

`StatePatchApplicatorConfig` gains `truthDuplicateSimilarity` (cosine threshold,
default `0.9`), beside `truthStableConfidence`. Embedding model name via env
(`EMBEDDING_MODEL`, default `text-embedding-3-small`); update `.env.example`.

### 4. Patch outcome `merged`

Add `'merged'` to `BehaviorPatchOutcome` union. Audit consumers of the union
during implementation (`BehaviorEventLogger` serializes JSON — fine; check for
any exhaustive `switch` on outcome). Persisted in `behavior_events.patch_results_json`,
so dedup events are observable / countable.

## Data flow — `truth.add` guard

In `applyTruthPatch`, `case 'truth.add'`:

1. Load dedup candidates: `findActiveEmbeddings(chatId)`. For any with
   `embedding === null`, compute (batched) and `setEmbedding`. Because truth
   patches are applied sequentially and each `add` awaits its INSERT, a fresh
   load per `add` already includes rows inserted earlier in the same batch — no
   in-memory accumulator needed.
2. Compute the new text's vector: `embed([patch.text])`.
3. Among candidates **excluding** ids in `patch.contradictsTruthIds` (an add
   that contradicts a truth is not a duplicate of it), find max cosine.
4. If `maxSim ≥ config.truthDuplicateSimilarity`: **merge** into the matched
   truth (reinforce semantics):
   - `sourceMessageIds = uniqueIds(existing ∪ patch.evidence.messageIds)`
   - `confidence = clampConfidence(existing + 0.2 * patch.evidence.confidence)`
   - `status = truthStatus(confidence)`
   - fold `patch.relatedTruthIds` / `patch.contradictsTruthIds` into the
     target's via `uniqueIds`
   - `truthRepo.update(target)`
   - return `{ patchType: 'truth.add', outcome: 'merged', reason: '#<id> sim=<v>', stateRef: { kind: 'bot_truth', chatId, truthId: target.id } }`
5. Else insert: `truthRepo.add({...}, newVector)`; return the usual
   `appliedTruth(...)`.

### Fail-open

If any embedding call throws (OpenAI error/timeout): log via the existing logger
and fall back to a plain `add` (insert with `embedding: null`; it backfills
lazily later). The truth is never lost and the pipeline never blocks on the
embedding service.

## Wiring

- Bind `EMBEDDING_SERVICE_ID → OpenAIEmbeddingService` in the container.
- Inject `EMBEDDING_SERVICE_ID` into `DefaultStatePatchApplicator`.
- Add `truthDuplicateSimilarity` to the applicator config binding.

## Testing

- **Applicator (unit, fake `EmbeddingService` returning controlled vectors):**
  - match ≥ threshold → outcome `merged`, **no** new row, target confidence
    bumped, evidence merged.
  - match < threshold → new row inserted, embedding stored.
  - best match is in `contradictsTruthIds` → insert (not merged).
  - embedding service throws → fail-open insert, outcome `applied`.
  - intra-batch: two near-identical `truth.add` in one decision → first inserts,
    second merges.
- **Repository:** `embedding_json` round-trips through SQLite;
  `findActiveEmbeddings` excludes `superseded`; `setEmbedding` updates.
- **Migration:** `017` up adds column / down drops it (mirror existing
  `behaviorMigration015` test style).
- **OpenAIEmbeddingService:** thin; mock the OpenAI client, assert model + batch
  request shape.

## Risks / open notes

- Threshold `0.9` is a starting guess; tune against the real duplicate examples
  (#5/#7, #8/#10) once embeddings are available.
- First `add` after deploy triggers a one-time batched backfill of a chat's
  active truths — bounded (few truths per chat), one request.
