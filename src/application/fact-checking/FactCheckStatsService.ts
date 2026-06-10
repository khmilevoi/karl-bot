import type { ServiceIdentifier } from 'inversify';

export interface FactCheckStatsService {
  getStatsSummary(
    chatId: number,
    period: 'daily' | 'weekly' | 'monthly'
  ): Promise<string>;
}

export const FACT_CHECK_STATS_SERVICE_ID = Symbol.for(
  'FactCheckStatsService'
) as ServiceIdentifier<FactCheckStatsService>;
