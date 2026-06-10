import type { ServiceIdentifier } from 'inversify';

export type FactCheckRunOutcome =
  | 'completed'
  | 'partial'
  | 'failed'
  | 'skipped_disabled'
  | 'skipped_no_messages';

export interface FactCheckRunResult {
  chatId: number;
  outcome: FactCheckRunOutcome;
  runId: number | null;
  processedMessages: number;
  persistedFindings: number;
}

export interface FactCheckPipeline {
  runHourly(chatId: number): Promise<FactCheckRunResult>;
  runStats(
    chatId: number,
    period: 'daily' | 'weekly' | 'monthly'
  ): Promise<FactCheckRunResult>;
}

export const FACT_CHECK_PIPELINE_ID = Symbol.for(
  'FactCheckPipeline'
) as ServiceIdentifier<FactCheckPipeline>;
