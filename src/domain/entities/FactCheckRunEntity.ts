export interface FactCheckRunEntity {
  id: number;
  chatId: number;
  runType: 'hourly' | 'daily' | 'weekly' | 'monthly';
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  messageFromId: number | null;
  messageToId: number | null;
  extractorModel: string | null;
  verifierModel: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  requestJson: string | null;
  responseJson: string | null;
}
