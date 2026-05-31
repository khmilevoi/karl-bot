import type { ServiceIdentifier } from 'inversify';

import type { UserPoliticalProfile } from '@/domain/behavior/schemas/state';

export interface UserPoliticalProfileRepository {
  findByChatAndUser(
    chatId: number,
    userId: number
  ): Promise<UserPoliticalProfile | undefined>;
  findByChat(chatId: number): Promise<UserPoliticalProfile[]>;
  upsert(profile: UserPoliticalProfile): Promise<void>;
}

export const USER_POLITICAL_PROFILE_REPOSITORY_ID = Symbol.for(
  'UserPoliticalProfileRepository'
) as ServiceIdentifier<UserPoliticalProfileRepository>;
