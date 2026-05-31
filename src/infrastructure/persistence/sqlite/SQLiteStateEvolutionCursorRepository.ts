import { inject, injectable } from 'inversify';

import type { StateEvolutionCursor } from '@/domain/entities/StateEvolutionCursorEntity';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { StateEvolutionCursorRepository } from '@/domain/repositories/StateEvolutionCursorRepository';

interface CursorRow {
  chat_id: number;
  last_event_id: number;
  last_run_at: string | null;
}

@injectable()
export class SQLiteStateEvolutionCursorRepository implements StateEvolutionCursorRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async get(chatId: number): Promise<StateEvolutionCursor | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<CursorRow>(
      'SELECT * FROM state_evolution_cursors WHERE chat_id = ?',
      chatId
    );
    return row
      ? {
          chatId: row.chat_id,
          lastEventId: row.last_event_id,
          lastRunAt: row.last_run_at,
        }
      : undefined;
  }

  async upsert(cursor: StateEvolutionCursor): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT INTO state_evolution_cursors (chat_id, last_event_id, last_run_at)
       VALUES (?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         last_event_id=excluded.last_event_id,
         last_run_at=excluded.last_run_at`,
      cursor.chatId,
      cursor.lastEventId,
      cursor.lastRunAt
    );
  }

  async findChatsNeedingSweep(notRunSinceIso: string): Promise<number[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<{ chat_id: number }>(
      `SELECT be.chat_id AS chat_id FROM behavior_events be
       LEFT JOIN state_evolution_cursors c ON c.chat_id = be.chat_id
       WHERE be.id > COALESCE(c.last_event_id, 0)
         AND be.model_slot != 'stateEvolution'
       GROUP BY be.chat_id
       HAVING c.last_run_at IS NULL OR c.last_run_at <= ?`,
      notRunSinceIso
    );
    return rows.map((r) => r.chat_id);
  }
}
