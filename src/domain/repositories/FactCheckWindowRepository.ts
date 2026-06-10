import type { ServiceIdentifier } from 'inversify';

import type { FactCheckWindowEntity } from '@/domain/entities/FactCheckWindowEntity';

export interface FactCheckWindowRepository {
  get(chatId: number): Promise<FactCheckWindowEntity | null>;
  upsert(window: FactCheckWindowEntity): Promise<void>;
}

export const FACT_CHECK_WINDOW_REPOSITORY_ID = Symbol.for(
  'FactCheckWindowRepository'
) as ServiceIdentifier<FactCheckWindowRepository>;
