import type { ServiceIdentifier } from 'inversify';

import type { StateEvolutionCursor } from '@/domain/entities/StateEvolutionCursorEntity';

export interface StateEvolutionCursorRepository {
  get(chatId: number): Promise<StateEvolutionCursor | undefined>;
  upsert(cursor: StateEvolutionCursor): Promise<void>;
  findChatsNeedingSweep(notRunSinceIso: string): Promise<number[]>;
}

export const STATE_EVOLUTION_CURSOR_REPOSITORY_ID = Symbol.for(
  'StateEvolutionCursorRepository'
) as ServiceIdentifier<StateEvolutionCursorRepository>;
