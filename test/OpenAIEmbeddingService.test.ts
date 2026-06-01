import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn(() => ({ embeddings: { create } })),
}));

import type { EnvService } from '../src/application/interfaces/env/EnvService';
import { OpenAIEmbeddingService } from '../src/infrastructure/external/OpenAIEmbeddingService';

function makeEnv(): EnvService {
  return { env: { OPENAI_KEY: 'test-key' } } as unknown as EnvService;
}

beforeEach(() => {
  create.mockReset();
});

describe('OpenAIEmbeddingService', () => {
  it('returns one vector per input text in order', async () => {
    create.mockResolvedValue({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    });
    const service = new OpenAIEmbeddingService(makeEnv());

    const vectors = await service.embed(['a', 'b']);

    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['a', 'b'],
    });
  });

  it('returns an empty array without calling the API for empty input', async () => {
    const service = new OpenAIEmbeddingService(makeEnv());

    const vectors = await service.embed([]);

    expect(vectors).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});
