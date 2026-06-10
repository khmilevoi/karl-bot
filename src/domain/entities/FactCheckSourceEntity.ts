import type { FactCheckSourceReliability } from '@/domain/fact-checking/FactCheckTypes';

export interface FactCheckSourceEntity {
  id: number;
  findingId: number;
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  reliability: FactCheckSourceReliability;
  retrievedAt: string;
}
