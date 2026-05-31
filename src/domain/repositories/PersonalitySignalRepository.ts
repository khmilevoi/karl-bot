import type { ServiceIdentifier } from 'inversify';

import type { PersonalitySignal } from '@/domain/behavior/schemas/state';

export type NewPersonalitySignal = PersonalitySignal & { chatId: number };

export interface PersonalitySignalRepository {
  add(signal: NewPersonalitySignal): Promise<number>;
  findByChatId(chatId: number): Promise<PersonalitySignal[]>;
}

export const PERSONALITY_SIGNAL_REPOSITORY_ID = Symbol.for(
  'PersonalitySignalRepository'
) as ServiceIdentifier<PersonalitySignalRepository>;
