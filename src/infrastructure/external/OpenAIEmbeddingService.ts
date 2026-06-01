import { inject, injectable } from 'inversify';
import OpenAI from 'openai';

import type { EmbeddingService } from '@/application/interfaces/ai/EmbeddingService';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';

const EMBEDDING_MODEL = 'text-embedding-3-small';

@injectable()
export class OpenAIEmbeddingService implements EmbeddingService {
  private readonly openai: OpenAI;

  constructor(@inject(ENV_SERVICE_ID) private readonly envService: EnvService) {
    this.openai = new OpenAI({ apiKey: this.envService.env.OPENAI_KEY });
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: [...texts],
    });
    return [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}
