import type { ServiceIdentifier } from 'inversify';

import type { FactCheckFindingWithSources } from '@/domain/entities/FactCheckFindingEntity';
import type {
  FactCheckCategory,
  FactCheckSeverity,
  FactCheckStatus,
  FactCheckSourcePolicy,
  FactCheckSourceReliability,
} from '@/domain/fact-checking/FactCheckTypes';

export interface CreateFactCheckRunInput {
  chatId: number;
  runType: 'hourly' | 'daily' | 'weekly' | 'monthly';
  startedAt: string;
  messageFromId: number | null;
  messageToId: number | null;
  extractorModel: string | null;
  verifierModel: string | null;
}

export interface CompleteFactCheckRunInput {
  runId: number;
  finishedAt: string;
  extractorModel: string | null;
  verifierModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  requestJson: unknown;
  responseJson: unknown;
}

export interface FailFactCheckRunInput {
  runId: number;
  finishedAt: string;
  errorMessage: string;
}

export interface InsertFactCheckSourceInput {
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  reliability: FactCheckSourceReliability;
  retrievedAt: string;
}

export interface InsertFactCheckFindingInput {
  runId: number;
  chatId: number;
  messageId: number;
  telegramMessageId: number | null;
  authorUserId: number | null;
  authorDisplayName: string;
  normalizedClaimKey: string;
  claimText: string;
  originalQuote: string;
  correctedFact: string;
  explanation: string;
  category: FactCheckCategory;
  severity: FactCheckSeverity;
  status: FactCheckStatus;
  confidence: number;
  sourcePolicy: FactCheckSourcePolicy;
  sourceRequirementsMet: boolean;
  shouldNotifyImmediately: boolean;
  messageUrl: string | null;
  createdAt: string;
  checkedAt: string;
  sources: readonly InsertFactCheckSourceInput[];
}

export type FactCheckStatsPeriod = 'daily' | 'weekly' | 'monthly';

export interface FactCheckStatsQuery {
  chatId: number;
  fromIso: string;
  toIso: string;
}

export interface FactCheckStatsRow {
  authorUserId: number | null;
  authorDisplayName: string;
  category: FactCheckCategory;
  status: FactCheckStatus;
  count: number;
}

// Used by the pipeline (run lifecycle).
export interface FactCheckRunRepository {
  createRun(input: CreateFactCheckRunInput): Promise<number>;
  completeRun(input: CompleteFactCheckRunInput): Promise<void>;
  failRun(input: FailFactCheckRunInput): Promise<void>;
}

// Used by the pipeline (insert) and the notifier (read + notification-state).
export interface FactCheckFindingRepository {
  insertFinding(input: InsertFactCheckFindingInput): Promise<number | null>;
  findUnsentImmediate(
    chatId: number,
    limit: number
  ): Promise<FactCheckFindingWithSources[]>;
  findUnsentDigest(
    chatId: number,
    limit: number
  ): Promise<FactCheckFindingWithSources[]>;
  markImmediateNotified(findingId: number, notifiedAt: string): Promise<void>;
  markDigestNotified(
    findingIds: readonly number[],
    notifiedAt: string
  ): Promise<void>;
  recordNotificationError(findingId: number, error: string): Promise<void>;
}

// Used by the stats service only.
export interface FactCheckStatsRepository {
  getStats(input: FactCheckStatsQuery): Promise<FactCheckStatsRow[]>;
}

export const FACT_CHECK_RUN_REPOSITORY_ID = Symbol.for(
  'FactCheckRunRepository'
) as ServiceIdentifier<FactCheckRunRepository>;
export const FACT_CHECK_FINDING_REPOSITORY_ID = Symbol.for(
  'FactCheckFindingRepository'
) as ServiceIdentifier<FactCheckFindingRepository>;
export const FACT_CHECK_STATS_REPOSITORY_ID = Symbol.for(
  'FactCheckStatsRepository'
) as ServiceIdentifier<FactCheckStatsRepository>;
