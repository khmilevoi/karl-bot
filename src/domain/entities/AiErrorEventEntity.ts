export interface AiErrorEventEntity {
  id: number;
  chatId: number | null;
  source: string;
  severity: 'warning' | 'error' | 'critical';
  errorCode: string;
  message: string;
  component: string;
  operation: string;
  inputRefJson: string | null;
  outputRefJson: string | null;
  stackHash: string | null;
  fixHint: string;
  status: 'open' | 'resolved' | 'ignored';
  createdAt: string;
}

export type NewAiErrorEvent = Omit<AiErrorEventEntity, 'id'>;
