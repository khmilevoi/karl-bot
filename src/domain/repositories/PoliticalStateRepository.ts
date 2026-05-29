import type { BotPoliticalState } from '@/domain/behavior/schemas/state';

export interface PoliticalStateRepository {
  findByChatId(chatId: number): Promise<BotPoliticalState | undefined>;
  upsert(state: BotPoliticalState): Promise<void>;
}

export const POLITICAL_STATE_REPOSITORY_ID = Symbol('PoliticalStateRepository');
