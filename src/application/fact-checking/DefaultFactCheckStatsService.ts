import { inject, injectable } from 'inversify';

import {
  FACT_CHECK_STATS_REPOSITORY_ID,
  type FactCheckStatsRepository,
  type FactCheckStatsRow,
} from '@/domain/repositories/FactCheckRepository';
import {
  formatStatsReport,
  type FactCheckStatsCategoryRow,
  type FactCheckStatsUserRow,
} from './FactCheckFormatter';
import type { FactCheckStatsService } from './FactCheckStatsService';
import type { FactCheckStatsPeriod } from '@/domain/repositories/FactCheckRepository';

function periodRange(
  period: FactCheckStatsPeriod,
  now: Date
): { fromIso: string; toIso: string } {
  const toIso = now.toISOString();
  const from = new Date(now);
  switch (period) {
    case 'daily':
      from.setDate(from.getDate() - 1);
      break;
    case 'weekly':
      from.setDate(from.getDate() - 7);
      break;
    case 'monthly':
      from.setMonth(from.getMonth() - 1);
      break;
  }
  return { fromIso: from.toISOString(), toIso };
}

@injectable()
export class DefaultFactCheckStatsService implements FactCheckStatsService {
  constructor(
    @inject(FACT_CHECK_STATS_REPOSITORY_ID)
    private readonly statsRepo: FactCheckStatsRepository
  ) {}

  async getStatsSummary(
    chatId: number,
    period: 'daily' | 'weekly' | 'monthly'
  ): Promise<string> {
    const { fromIso, toIso } = periodRange(period, new Date());
    const rows = await this.statsRepo.getStats({ chatId, fromIso, toIso });

    const { confirmed, uncertain, userMap, categoryMap } =
      this.aggregateRows(rows);

    const topUsers = [...userMap.values()].sort(
      (a, b) => b.confirmed + b.uncertain - (a.confirmed + a.uncertain)
    );

    const categories = [...categoryMap.values()].sort(
      (a, b) => b.confirmed + b.uncertain - (a.confirmed + a.uncertain)
    );

    return formatStatsReport({
      period,
      fromIso,
      toIso,
      totalConfirmed: confirmed,
      totalUncertain: uncertain,
      topUsers,
      categories,
    });
  }

  private aggregateRows(rows: FactCheckStatsRow[]): {
    confirmed: number;
    uncertain: number;
    userMap: Map<string, FactCheckStatsUserRow>;
    categoryMap: Map<string, FactCheckStatsCategoryRow>;
  } {
    let confirmed = 0;
    let uncertain = 0;
    const userMap = new Map<string, FactCheckStatsUserRow>();
    const categoryMap = new Map<string, FactCheckStatsCategoryRow>();

    for (const row of rows) {
      const isConfirmed = row.status === 'confirmed';
      const rowConfirmed = isConfirmed ? row.count : 0;
      const rowUncertain = isConfirmed ? 0 : row.count;

      confirmed += rowConfirmed;
      uncertain += rowUncertain;

      const key = row.authorDisplayName;
      const existing = userMap.get(key) ?? {
        authorDisplayName: key,
        confirmed: 0,
        uncertain: 0,
      };
      existing.confirmed += rowConfirmed;
      existing.uncertain += rowUncertain;
      userMap.set(key, existing);

      const cat = row.category;
      const existingCat = categoryMap.get(cat) ?? {
        category: cat,
        confirmed: 0,
        uncertain: 0,
      };
      existingCat.confirmed += rowConfirmed;
      existingCat.uncertain += rowUncertain;
      categoryMap.set(cat, existingCat);
    }

    return { confirmed, uncertain, userMap, categoryMap };
  }
}
