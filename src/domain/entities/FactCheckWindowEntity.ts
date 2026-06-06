export interface FactCheckWindowEntity {
  chatId: number;
  lastCheckedMessageId: number;
  lastCheckedAt: string | null;
  updatedAt: string;
}
