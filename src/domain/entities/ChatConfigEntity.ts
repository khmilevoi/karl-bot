export interface ChatConfigEntity {
  chatId: number;
  historyLimit: number;
  topicTime: string | null;
  topicTimezone: string;
}
