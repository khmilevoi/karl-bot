import { inject, injectable } from 'inversify';

import type { EmbeddingService } from '@/application/interfaces/ai/EmbeddingService';
import {
  AI_GATEWAY_ID,
  type AiGateway,
} from '@/application/interfaces/ai/AiGateway';

const EMBEDDING_MODEL = 'text-embedding-3-small';

@injectable()
export class OpenAIEmbeddingService implements EmbeddingService {
  constructor(@inject(AI_GATEWAY_ID) private readonly gateway: AiGateway) {}

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
