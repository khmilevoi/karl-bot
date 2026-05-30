import type { BotPersonalityState } from '@/domain/behavior/schemas/state';

export interface PersonalityStateRepository {
  findByChatId(chatId: number): Promise<BotPersonalityState | undefined>;
  upsert(state: BotPersonalityState): Promise<void>;
}

export const PERSONALITY_STATE_REPOSITORY_ID = Symbol(
  'PersonalityStateRepository'
);
