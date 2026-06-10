import type { ServiceIdentifier } from 'inversify';

import type { AiUsage } from '@/application/interfaces/ai/AiGateway';
import type {
  FactCheckExtractionPromptContext,
  FactCheckVerificationPromptContext,
} from '@/application/fact-checking/FactCheckPromptContext';
import type {
  ClaimExtractionResult,
  FactVerificationResult,
} from '@/domain/fact-checking/FactCheckSchemas';

export interface FactCheckAiMetadata {
  modelSlot: string;
  selectedModel: string;
  escalated: boolean;
  escalationReason: string | null;
  latencyMs: number;
  usage: AiUsage;
}

export interface FactCheckAiResult<T> {
  result: T;
  metadata: FactCheckAiMetadata;
  requestJson: unknown;
  responseJson: unknown;
}

export interface FactCheckReasoningService {
  extractClaims(
    input: FactCheckExtractionPromptContext
  ): Promise<FactCheckAiResult<ClaimExtractionResult>>;
  verifyClaims(
    input: FactCheckVerificationPromptContext
  ): Promise<FactCheckAiResult<FactVerificationResult>>;
}

export const FACT_CHECK_REASONING_SERVICE_ID = Symbol.for(
  'FactCheckReasoningService'
) as ServiceIdentifier<FactCheckReasoningService>;
