import { inject, injectable } from 'inversify';

import {
  type PersonalitySignal,
  personalitySignalSchema,
} from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type {
  NewPersonalitySignal,
  PersonalitySignalRepository,
} from '@/domain/repositories/PersonalitySignalRepository';

interface SignalRow {
  id: number;
  chat_id: number;
  area: string;
  polarity: string;
  text: string;
  evidence_message_ids_json: string;
  status: string;
  created_at: string;
}

function toSignal(row: SignalRow): PersonalitySignal {
  return personalitySignalSchema.parse({
    area: row.area,
    polarity: row.polarity,
    text: row.text,
    evidenceMessageIds: JSON.parse(row.evidence_message_ids_json),
    status: row.status,
    createdAt: row.created_at,
  });
}

@injectable()
export class SQLitePersonalitySignalRepository implements PersonalitySignalRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async add(signal: NewPersonalitySignal): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `INSERT INTO bot_personality_signals
        (chat_id, area, polarity, text, evidence_message_ids_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      signal.chatId,
      signal.area,
      signal.polarity,
      signal.text,
      JSON.stringify(signal.evidenceMessageIds),
      signal.status,
      signal.createdAt
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async findByChatId(chatId: number): Promise<PersonalitySignal[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<SignalRow>(
      'SELECT * FROM bot_personality_signals WHERE chat_id = ? ORDER BY id',
      chatId
    );
    return rows.map(toSignal);
  }
}
