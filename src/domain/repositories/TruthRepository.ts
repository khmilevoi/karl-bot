import type { BotTruth } from '@/domain/behavior/schemas/state';

export type NewTruth = Omit<BotTruth, 'id'>;

export interface TruthEmbedding {
  id: number;
  text: string;
  embedding: number[] | null;
}

export interface TruthRepository {
  add(truth: NewTruth, embedding?: number[] | null): Promise<number>;
  findById(id: number): Promise<BotTruth | undefined>;
  findByChatId(chatId: number): Promise<BotTruth[]>;
  update(truth: BotTruth): Promise<void>;
  findActiveEmbeddings(chatId: number): Promise<TruthEmbedding[]>;
  setEmbedding(id: number, embedding: number[]): Promise<void>;
}

export const TRUTH_REPOSITORY_ID = Symbol('TruthRepository');
