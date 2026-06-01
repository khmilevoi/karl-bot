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
