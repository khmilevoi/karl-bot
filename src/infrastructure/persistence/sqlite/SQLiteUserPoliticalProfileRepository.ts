import { inject, injectable } from 'inversify';

import {
  type UserPoliticalProfile,
  userPoliticalProfileSchema,
} from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { UserPoliticalProfileRepository } from '@/domain/repositories/UserPoliticalProfileRepository';

interface ProfileRow {
  chat_id: number;
  user_id: number;
  notes_json: string;
  compass_json: string;
  updated_at: string;
}

function toProfile(row: ProfileRow): UserPoliticalProfile {
  return userPoliticalProfileSchema.parse({
    chatId: row.chat_id,
    userId: row.user_id,
    notes: JSON.parse(row.notes_json),
    compass: JSON.parse(row.compass_json),
    updatedAt: row.updated_at,
  });
}

@injectable()
export class SQLiteUserPoliticalProfileRepository implements UserPoliticalProfileRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async findByChatAndUser(
    chatId: number,
    userId: number
  ): Promise<UserPoliticalProfile | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<ProfileRow>(
      'SELECT * FROM user_political_profiles WHERE chat_id = ? AND user_id = ?',
      chatId,
      userId
    );
    return row ? toProfile(row) : undefined;
  }

  async findByChat(chatId: number): Promise<UserPoliticalProfile[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<ProfileRow>(
      'SELECT * FROM user_political_profiles WHERE chat_id = ? ORDER BY user_id',
      chatId
    );
    return rows.map(toProfile);
  }

  async upsert(profile: UserPoliticalProfile): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT INTO user_political_profiles (chat_id, user_id, notes_json, compass_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, user_id) DO UPDATE SET
         notes_json=excluded.notes_json,
         compass_json=excluded.compass_json,
         updated_at=excluded.updated_at`,
      profile.chatId,
      profile.userId,
      JSON.stringify(profile.notes),
      JSON.stringify(profile.compass),
      profile.updatedAt
    );
  }
}
