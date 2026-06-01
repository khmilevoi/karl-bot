import type { ServiceIdentifier } from 'inversify';

export interface EmbeddingService {
  // One vector per input text, returned in the same order.
  embed(texts: readonly string[]): Promise<number[][]>;
}

export const EMBEDDING_SERVICE_ID = Symbol.for(
  'EmbeddingService'
) as ServiceIdentifier<EmbeddingService>;
