import type { ServiceIdentifier } from 'inversify';

import type { FactCheckSourceReliability } from '@/domain/fact-checking/FactCheckTypes';

export interface SourceSearchRequest {
  claimText: string;
  category: string;
  maxSources: number;
}

export interface SourceSearchResult {
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  reliability: FactCheckSourceReliability;
  retrievedAt: string;
}

export interface SourceSearchService {
  search(request: SourceSearchRequest): Promise<SourceSearchResult[]>;
}

export const SOURCE_SEARCH_SERVICE_ID = Symbol.for(
  'SourceSearchService'
) as ServiceIdentifier<SourceSearchService>;
