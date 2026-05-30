import type { UserSocialProfile } from '@/domain/behavior/schemas/state';

export interface UserSocialProfileRepository {
  findByChatAndUser(
    chatId: number,
    userId: number
  ): Promise<UserSocialProfile | undefined>;
  findByChat(chatId: number): Promise<UserSocialProfile[]>;
  upsert(profile: UserSocialProfile): Promise<void>;
}

export const USER_SOCIAL_PROFILE_REPOSITORY_ID = Symbol(
  'UserSocialProfileRepository'
);
