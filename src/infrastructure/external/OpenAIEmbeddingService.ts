import { inject, injectable } from 'inversify';

import type { EmbeddingService } from '@/application/interfaces/ai/EmbeddingService';
import {
  OPEN_AI_GATEWAY_ID,
  type OpenAiGateway,
} from '@/application/interfaces/ai/OpenAiGateway';

const EMBEDDING_MODEL = 'text-embedding-3-small';

@injectable()
export class OpenAIEmbeddingService implements EmbeddingService {
  constructor(
    @inject(OPEN_AI_GATEWAY_ID) private readonly gateway: OpenAiGateway
  ) {}

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    return this.gateway.createEmbeddings({
      model: EMBEDDING_MODEL,
      texts,
    });
  }
}
