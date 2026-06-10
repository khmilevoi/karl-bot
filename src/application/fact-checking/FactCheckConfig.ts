import type { ServiceIdentifier } from 'inversify';

export interface FactCheckConfig {
  enabled: boolean;
  maxMessagesPerBatch: number;
  maxClaimsPerBatch: number;
  maxHistoryContextMessages: number;
  maxSourceSearchesPerBatch: number;
  maxSourcesPerFinding: number;
  maxDisplayedSourcesPerFinding: number;
  maxFindingsPerDigestMessage: number;
  verificationConfidenceThreshold: number;
}

export const FACT_CHECK_CONFIG_ID = Symbol.for(
  'FactCheckConfig'
) as ServiceIdentifier<FactCheckConfig>;
