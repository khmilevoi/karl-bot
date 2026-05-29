import { inject, injectable } from 'inversify';

import type { BotPersonalityState } from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { PersonalityStateRepository } from '@/domain/repositories/PersonalityStateRepository';

interface PersonalityRow {
  chat_id: number;
  identity_notes_json: string;
  values_json: string;
  speech_style_json: string;
  social_habits_json: string;
  recurring_themes_json: string;
  last_updated_at: string;
}

@injectable()
export class SQLitePersonalityStateRepository implements PersonalityStateRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async findByChatId(chatId: number): Promise<BotPersonalityState | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<PersonalityRow>(
      'SELECT chat_id, identity_notes_json, values_json, speech_style_json, social_habits_json, recurring_themes_json, last_updated_at FROM bot_personality_states WHERE chat_id = ?',
      chatId
    );
    if (!row) {
      return undefined;
    }
    return {
      chatId: row.chat_id,
      identityNotes: JSON.parse(row.identity_notes_json) as string[],
      values: JSON.parse(row.values_json) as string[],
      speechStyle: JSON.parse(
        row.speech_style_json
      ) as BotPersonalityState['speechStyle'],
      socialHabits: JSON.parse(row.social_habits_json) as string[],
      recurringThemes: JSON.parse(row.recurring_themes_json) as string[],
      lastUpdatedAt: row.last_updated_at,
    };
  }

  async upsert(state: BotPersonalityState): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT INTO bot_personality_states
        (chat_id, identity_notes_json, values_json, speech_style_json, social_habits_json, recurring_themes_json, last_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         identity_notes_json=excluded.identity_notes_json,
         values_json=excluded.values_json,
         speech_style_json=excluded.speech_style_json,
         social_habits_json=excluded.social_habits_json,
         recurring_themes_json=excluded.recurring_themes_json,
         last_updated_at=excluded.last_updated_at`,
      state.chatId,
      JSON.stringify(state.identityNotes),
      JSON.stringify(state.values),
      JSON.stringify(state.speechStyle),
      JSON.stringify(state.socialHabits),
      JSON.stringify(state.recurringThemes),
      state.lastUpdatedAt
    );
  }
}
