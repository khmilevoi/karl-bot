import { inject, injectable } from 'inversify';

import type {
  FactCheckFindingEntity,
  FactCheckFindingWithSources,
} from '@/domain/entities/FactCheckFindingEntity';
import type { FactCheckSourceEntity } from '@/domain/entities/FactCheckSourceEntity';
import type {
  CompleteFactCheckRunInput,
  CreateFactCheckRunInput,
  FactCheckFindingRepository,
  FactCheckRunRepository,
  FactCheckStatsQuery,
  FactCheckStatsRepository,
  FactCheckStatsRow,
  FailFactCheckRunInput,
  InsertFactCheckFindingInput,
} from '@/domain/repositories/FactCheckRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type {
  FactCheckCategory,
  FactCheckSeverity,
  FactCheckSourcePolicy,
  FactCheckSourceReliability,
  FactCheckStatus,
} from '@/domain/fact-checking/FactCheckTypes';

interface FindingRow {
  id: number;
  run_id: number;
  chat_id: number;
  message_id: number;
  telegram_message_id: number | null;
  author_user_id: number | null;
  author_display_name: string;
  normalized_claim_key: string;
  claim_text: string;
  original_quote: string;
  corrected_fact: string;
  explanation: string;
  category: FactCheckCategory;
  severity: FactCheckSeverity;
  status: FactCheckStatus;
  confidence: number;
  source_policy: FactCheckSourcePolicy;
  source_requirements_met: number;
  should_notify_immediately: number;
  message_url: string | null;
  immediate_notified_at: string | null;
  digest_notified_at: string | null;
  notification_error: string | null;
  created_at: string;
  checked_at: string;
}

interface SourceRow {
  id: number;
  finding_id: number;
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  reliability: FactCheckSourceReliability;
  retrieved_at: string;
}

interface StatsRow {
  author_user_id: number | null;
  author_display_name: string;
  category: FactCheckCategory;
  status: FactCheckStatus;
  count: number;
}

function rowToFinding(row: FindingRow): FactCheckFindingEntity {
  return {
    id: row.id,
    runId: row.run_id,
    chatId: row.chat_id,
    messageId: row.message_id,
    telegramMessageId: row.telegram_message_id,
    authorUserId: row.author_user_id,
    authorDisplayName: row.author_display_name,
    normalizedClaimKey: row.normalized_claim_key,
    claimText: row.claim_text,
    originalQuote: row.original_quote,
    correctedFact: row.corrected_fact,
    explanation: row.explanation,
    category: row.category,
    severity: row.severity,
    status: row.status,
    confidence: row.confidence,
    sourcePolicy: row.source_policy,
    sourceRequirementsMet: row.source_requirements_met === 1,
    shouldNotifyImmediately: row.should_notify_immediately === 1,
    messageUrl: row.message_url,
    immediateNotifiedAt: row.immediate_notified_at,
    digestNotifiedAt: row.digest_notified_at,
    notificationError: row.notification_error,
    createdAt: row.created_at,
    checkedAt: row.checked_at,
  };
}

function rowToSource(row: SourceRow): FactCheckSourceEntity {
  return {
    id: row.id,
    findingId: row.finding_id,
    url: row.url,
    title: row.title,
    publisher: row.publisher,
    snippet: row.snippet,
    reliability: row.reliability,
    retrievedAt: row.retrieved_at,
  };
}

async function attachSources(
  db: Awaited<ReturnType<DbProvider['get']>>,
  findings: FactCheckFindingEntity[]
): Promise<FactCheckFindingWithSources[]> {
  if (findings.length === 0) return [];
  const ids = findings.map((f) => f.id);
  const placeholders = ids.map(() => '?').join(', ');
  const sourceRows = await db.all<SourceRow>(
    `SELECT id, finding_id, url, title, publisher, snippet, reliability, retrieved_at FROM fact_check_sources WHERE finding_id IN (${placeholders})`,
    ...ids
  );
  const sourcesByFinding = new Map<number, FactCheckSourceEntity[]>();
  for (const row of sourceRows ?? []) {
    const src = rowToSource(row);
    const arr = sourcesByFinding.get(src.findingId) ?? [];
    arr.push(src);
    sourcesByFinding.set(src.findingId, arr);
  }
  return findings.map((f) => ({
    ...f,
    sources: sourcesByFinding.get(f.id) ?? [],
  }));
}

@injectable()
export class SQLiteFactCheckRepository
  implements
    FactCheckRunRepository,
    FactCheckFindingRepository,
    FactCheckStatsRepository
{
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async createRun(input: CreateFactCheckRunInput): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      'INSERT INTO fact_check_runs (chat_id, run_type, status, started_at, message_from_id, message_to_id, extractor_model, verifier_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      input.chatId,
      input.runType,
      'running',
      input.startedAt,
      input.messageFromId,
      input.messageToId,
      input.extractorModel,
      input.verifierModel
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async completeRun(input: CompleteFactCheckRunInput): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      'UPDATE fact_check_runs SET status=?, finished_at=?, prompt_tokens=?, completion_tokens=?, total_tokens=?, latency_ms=?, request_json=?, response_json=? WHERE id=?',
      'completed',
      input.finishedAt,
      input.promptTokens,
      input.completionTokens,
      input.totalTokens,
      input.latencyMs,
      JSON.stringify(input.requestJson),
      JSON.stringify(input.responseJson),
      input.runId
    );
  }

  async failRun(input: FailFactCheckRunInput): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      'UPDATE fact_check_runs SET status=?, finished_at=?, error_message=? WHERE id=?',
      'failed',
      input.finishedAt,
      input.errorMessage,
      input.runId
    );
  }

  async insertFinding(
    input: InsertFactCheckFindingInput
  ): Promise<number | null> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      'INSERT OR IGNORE INTO fact_check_findings (run_id, chat_id, message_id, telegram_message_id, author_user_id, author_display_name, normalized_claim_key, claim_text, original_quote, corrected_fact, explanation, category, severity, status, confidence, source_policy, source_requirements_met, should_notify_immediately, message_url, created_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      input.runId,
      input.chatId,
      input.messageId,
      input.telegramMessageId,
      input.authorUserId,
      input.authorDisplayName,
      input.normalizedClaimKey,
      input.claimText,
      input.originalQuote,
      input.correctedFact,
      input.explanation,
      input.category,
      input.severity,
      input.status,
      input.confidence,
      input.sourcePolicy,
      input.sourceRequirementsMet ? 1 : 0,
      input.shouldNotifyImmediately ? 1 : 0,
      input.messageUrl,
      input.createdAt,
      input.checkedAt
    )) as { lastID?: number; changes?: number };

    if ((result.changes ?? 0) === 0) return null;
    const findingId = result.lastID ?? 0;

    for (const src of input.sources) {
      await db.run(
        'INSERT INTO fact_check_sources (finding_id, url, title, publisher, snippet, reliability, retrieved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        findingId,
        src.url,
        src.title,
        src.publisher,
        src.snippet,
        src.reliability,
        src.retrievedAt
      );
    }

    return findingId;
  }

  async findUnsentImmediate(
    chatId: number,
    limit: number
  ): Promise<FactCheckFindingWithSources[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<FindingRow>(
      'SELECT * FROM fact_check_findings WHERE chat_id = ? AND should_notify_immediately = 1 AND immediate_notified_at IS NULL ORDER BY checked_at ASC LIMIT ?',
      chatId,
      limit
    );
    const findings = (rows ?? []).map(rowToFinding);
    return attachSources(db, findings);
  }

  async findUnsentDigest(
    chatId: number,
    limit: number
  ): Promise<FactCheckFindingWithSources[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<FindingRow>(
      'SELECT * FROM fact_check_findings WHERE chat_id = ? AND should_notify_immediately = 0 AND digest_notified_at IS NULL ORDER BY checked_at ASC LIMIT ?',
      chatId,
      limit
    );
    const findings = (rows ?? []).map(rowToFinding);
    return attachSources(db, findings);
  }

  async markImmediateNotified(
    findingId: number,
    notifiedAt: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      'UPDATE fact_check_findings SET immediate_notified_at = ? WHERE id = ?',
      notifiedAt,
      findingId
    );
  }

  async markDigestNotified(
    findingIds: readonly number[],
    notifiedAt: string
  ): Promise<void> {
    if (findingIds.length === 0) return;
    const db = await this.dbProvider.get();
    const placeholders = findingIds.map(() => '?').join(', ');
    await db.run(
      `UPDATE fact_check_findings SET digest_notified_at = ? WHERE id IN (${placeholders})`,
      notifiedAt,
      ...findingIds
    );
  }

  async recordNotificationError(
    findingId: number,
    error: string
  ): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      'UPDATE fact_check_findings SET notification_error = ? WHERE id = ?',
      error,
      findingId
    );
  }

  async getStats(input: FactCheckStatsQuery): Promise<FactCheckStatsRow[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<StatsRow>(
      'SELECT author_user_id, author_display_name, category, status, COUNT(*) as count FROM fact_check_findings WHERE chat_id = ? AND checked_at >= ? AND checked_at <= ? GROUP BY author_user_id, author_display_name, category, status',
      input.chatId,
      input.fromIso,
      input.toIso
    );
    return (rows ?? []).map((r) => ({
      authorUserId: r.author_user_id,
      authorDisplayName: r.author_display_name,
      category: r.category,
      status: r.status,
      count: r.count,
    }));
  }
}
