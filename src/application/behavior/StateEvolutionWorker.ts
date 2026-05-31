import type { ServiceIdentifier } from 'inversify';

export interface StateEvolutionWorker {
  requestRun(chatId: number): void;
}

export const STATE_EVOLUTION_WORKER_ID = Symbol.for(
  'StateEvolutionWorker'
) as ServiceIdentifier<StateEvolutionWorker>;
