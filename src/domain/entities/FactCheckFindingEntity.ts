import type {
  FactCheckCategory,
  FactCheckSeverity,
  FactCheckStatus,
  FactCheckSourcePolicy,
} from '@/domain/fact-checking/FactCheckTypes';

import type { FactCheckSourceEntity } from './FactCheckSourceEntity';

export interface FactCheckFindingEntity {
  id: number;
  runId: number;
  chatId: number;
  messageId: number;
  telegramMessageId: number | null;
  authorUserId: number | null;
  authorDisplayName: string;
  normalizedClaimKey: string;
  claimText: string;
  originalQuote: string;
  correctedFact: string;
  explanation: string;
  category: FactCheckCategory;
  severity: FactCheckSeverity;
  status: FactCheckStatus;
  confidence: number;
  sourcePolicy: FactCheckSourcePolicy;
  sourceRequirementsMet: boolean;
  messageUrl: string | null;
  immediateNotifiedAt: string | null;
  digestNotifiedAt: string | null;
  notificationError: string | null;
  createdAt: string;
  checkedAt: string;
}

export interface FactCheckFindingWithSources extends FactCheckFindingEntity {
  sources: FactCheckSourceEntity[];
}
