import { inject, injectable } from 'inversify';

import {
  type UserSocialProfile,
  userSocialProfileSchema,
} from '@/domain/behavior/schemas/state';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';
import type { UserSocialProfileRepository } from '@/domain/repositories/UserSocialProfileRepository';

interface ProfileRow {
  chat_id: number;
  user_id: number;
  username: string | null;
  affinity_score: number;
  labels_json: string;
  patterns_json: string;
  grudges_json: string;
  trust_level: string;
  preferred_distance: string;
  communication_style: string;
  conflict_style: string;
  preferred_tone: string;
  interests_json: string;
  updated_at: string;
}

function toProfile(row: ProfileRow): UserSocialProfile {
  return userSocialProfileSchema.parse({
    userId: row.user_id,
    chatId: row.chat_id,
    username: row.username,
    affinityScore: row.affinity_score,
    labels: JSON.parse(row.labels_json),
    patterns: JSON.parse(row.patterns_json),
    grudges: JSON.parse(row.grudges_json),
    trustLevel: row.trust_level,
    preferredDistance: row.preferred_distance,
    communicationStyle: row.communication_style,
    conflictStyle: row.conflict_style,
    preferredTone: row.preferred_tone,
    interests: JSON.parse(row.interests_json),
    updatedAt: row.updated_at,
  });
}

@injectable()
export class SQLiteUserSocialProfileRepository implements UserSocialProfileRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async findByChatAndUser(
    chatId: number,
    userId: number
  ): Promise<UserSocialProfile | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<ProfileRow>(
      'SELECT * FROM user_social_profiles WHERE chat_id = ? AND user_id = ?',
      chatId,
      userId
    );
    return row ? toProfile(row) : undefined;
  }

  async findByChat(chatId: number): Promise<UserSocialProfile[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<ProfileRow>(
      'SELECT * FROM user_social_profiles WHERE chat_id = ? ORDER BY user_id',
      chatId
    );
    return rows.map(toProfile);
  }

  async upsert(profile: UserSocialProfile): Promise<void> {
    const db = await this.dbProvider.get();
    await db.run(
      `INSERT INTO user_social_profiles
        (chat_id, user_id, username, affinity_score, labels_json, patterns_json, grudges_json, trust_level, preferred_distance, communication_style, conflict_style, preferred_tone, interests_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, user_id) DO UPDATE SET
         username=excluded.username,
         affinity_score=excluded.affinity_score,
         labels_json=excluded.labels_json,
         patterns_json=excluded.patterns_json,
         grudges_json=excluded.grudges_json,
         trust_level=excluded.trust_level,
         preferred_distance=excluded.preferred_distance,
         communication_style=excluded.communication_style,
         conflict_style=excluded.conflict_style,
         preferred_tone=excluded.preferred_tone,
         interests_json=excluded.interests_json,
         updated_at=excluded.updated_at`,
      profile.chatId,
      profile.userId,
      profile.username,
      profile.affinityScore,
      JSON.stringify(profile.labels),
      JSON.stringify(profile.patterns),
      JSON.stringify(profile.grudges),
      profile.trustLevel,
      profile.preferredDistance,
      profile.communicationStyle,
      profile.conflictStyle,
      profile.preferredTone,
      JSON.stringify(profile.interests),
      profile.updatedAt
    );
  }
}
