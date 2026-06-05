import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiGateway } from '../src/application/interfaces/ai/AiGateway';
import { OpenAIEmbeddingService } from '../src/infrastructure/external/OpenAIEmbeddingService';

let createEmbeddings: ReturnType<typeof vi.fn>;
let gateway: AiGateway;

beforeEach(() => {
  createEmbeddings = vi.fn();
  gateway = {
    createEmbeddings,
  } as unknown as AiGateway;
});

describe('OpenAIEmbeddingService', () => {
  it('delegates embedding creation to the AI gateway', async () => {
    createEmbeddings.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);
    const service = new OpenAIEmbeddingService(gateway);

    const vectors = await service.embed(['a', 'b']);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(createEmbeddings).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      texts: ['a', 'b'],
    });
  });

  it('returns an empty array without calling the API for empty input', async () => {
    const service = new OpenAIEmbeddingService(gateway);

    const vectors = await service.embed([]);

    expect(vectors).toEqual([]);
    expect(createEmbeddings).not.toHaveBeenCalled();
  });
});
