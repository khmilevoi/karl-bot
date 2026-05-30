import { inject, injectable } from 'inversify';

import {
  type BotPoliticalState,
  botPoliticalStateSchema,
} from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { PoliticalStateRepository } from '@/domain/repositories/PoliticalStateRepository';

interface PoliticalRow {
  chat_id: number;
  ideology_summary: string;
  positions_json: string;
  uncertainty_areas_json: string;
  influence_history_json: string;
  last_updated_at: string;
}

@injectable()
export class SQLitePoliticalStateRepository implements PoliticalStateRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async findByChatId(chatId: number): Promise<BotPoliticalState | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<PoliticalRow>(
      'SELECT chat_id, ideology_summary, positions_json, uncertainty_areas_json, influence_history_json, last_updated_at FROM bot_political_states WHERE chat_id = ?',
      chatId
    );
    if (!row) {
      return undefined;
    }
    return botPoliticalStateSchema.parse({
      chatId: row.chat_id,
      ideologySummary: row.ideology_summary,
      positions: JSON.parse(row.positions_json),
      uncertaintyAreas: JSON.parse(row.uncertainty_areas_json),
      influenceHistory: JSON.parse(row.influence_history_json),
      lastUpdatedAt: row.last_updated_at,
    });
  }

  async upsert(state: BotPoliticalState): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT INTO bot_political_states
        (chat_id, ideology_summary, positions_json, uncertainty_areas_json, influence_history_json, last_updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         ideology_summary=excluded.ideology_summary,
         positions_json=excluded.positions_json,
         uncertainty_areas_json=excluded.uncertainty_areas_json,
         influence_history_json=excluded.influence_history_json,
         last_updated_at=excluded.last_updated_at`,
      state.chatId,
      state.ideologySummary,
      JSON.stringify(state.positions),
      JSON.stringify(state.uncertaintyAreas),
      JSON.stringify(state.influenceHistory),
      state.lastUpdatedAt
    );
  }
}
