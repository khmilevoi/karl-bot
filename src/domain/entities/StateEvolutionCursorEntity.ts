export interface StateEvolutionCursor {
  chatId: number;
  lastEventId: number;
  lastRunAt: string | null;
}
