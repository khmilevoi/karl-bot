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
