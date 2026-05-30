import type { BotTruth } from '@/domain/behavior/schemas/state';

export type NewTruth = Omit<BotTruth, 'id'>;

export interface TruthRepository {
  add(truth: NewTruth): Promise<number>;
  findById(id: number): Promise<BotTruth | undefined>;
  findByChatId(chatId: number): Promise<BotTruth[]>;
  update(truth: BotTruth): Promise<void>;
}

export const TRUTH_REPOSITORY_ID = Symbol('TruthRepository');
