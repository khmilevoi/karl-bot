import { describe, expect, it, vi } from 'vitest';

import {
  DefaultFactCheckSourceSearchService,
  extractUrlCitations,
} from '../src/application/fact-checking/DefaultFactCheckSourceSearchService';
import type { AiGateway, AiResponseResult } from '../src/application/interfaces/ai/AiGateway';
import type { EnvService } from '../src/application/interfaces/env/EnvService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

function makeEnvService(): EnvService {
  return {
    env: {},
    getModels: () => ({
      sourceSearch: { default: 'gpt-5.4-mini' },
      triggerGate: { default: 'gpt-5.4-mini' },
      behaviorDecision: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
      summarization: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
      stateEvolution: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
      errorRepair: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
      factCheckExtraction: { default: 'gpt-5.4-mini' },
      factCheckVerification: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
    }),
  } as unknown as EnvService;
}

function makeLoggerFactory(): LoggerFactory {
  return {
    create: () => ({
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    }),
  } as unknown as LoggerFactory;
}

function makeGateway(result: AiResponseResult): AiGateway {
  return {
    createResponse: vi.fn(async () => result),
    parseChatCompletion: vi.fn(),
    createChatCompletion: vi.fn(),
    createEmbeddings: vi.fn(),
    transcribeAudio: vi.fn(),
  } as unknown as AiGateway;
}

function makeCitationRaw(
  citations: Array<{ url: string; title: string; start_index?: number; end_index?: number }>
): unknown {
  return {
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Some output text from the model.',
            annotations: citations.map((c) => ({
              type: 'url_citation',
              url: c.url,
              title: c.title,
              start_index: c.start_index ?? 0,
              end_index: c.end_index ?? 5,
            })),
          },
        ],
      },
    ],
  };
}

describe('extractUrlCitations', () => {
  it('extracts citations from valid raw response', () => {
    const raw = makeCitationRaw([
      { url: 'https://example.com', title: 'Example' },
    ]);
    const citations = extractUrlCitations(raw);
    expect(citations).toHaveLength(1);
    expect(citations[0].url).toBe('https://example.com');
    expect(citations[0].title).toBe('Example');
  });

  it('returns empty array for null raw', () => {
    expect(extractUrlCitations(null)).toEqual([]);
  });

  it('returns empty array for non-object raw', () => {
    expect(extractUrlCitations('string')).toEqual([]);
  });

  it('returns empty array when output has no message items', () => {
    const raw = { output: [{ type: 'web_search_call' }] };
    expect(extractUrlCitations(raw)).toEqual([]);
  });

  it('skips non-url_citation annotations', () => {
    const raw = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'text',
              annotations: [{ type: 'file_citation', url: 'https://a.com' }],
            },
          ],
        },
      ],
    };
    expect(extractUrlCitations(raw)).toEqual([]);
  });
});

describe('DefaultFactCheckSourceSearchService', () => {
  it('calls gateway.createResponse with web_search_preview tool', async () => {
    const gateway = makeGateway({
      outputText: '',
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw: { output: [] },
    });
    const svc = new DefaultFactCheckSourceSearchService(
      makeEnvService(),
      gateway,
      makeLoggerFactory()
    );
    await svc.search({ claimText: 'claim', category: 'external_fact', maxSources: 5 });

    expect(gateway.createResponse).toHaveBeenCalledOnce();
    const call = (gateway.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe('gpt-5.4-mini');
    expect(call.tools).toEqual([{ type: 'web_search_preview' }]);
  });

  it('returns empty array when no citations in response', async () => {
    const gateway = makeGateway({
      outputText: '',
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw: { output: [] },
    });
    const svc = new DefaultFactCheckSourceSearchService(
      makeEnvService(),
      gateway,
      makeLoggerFactory()
    );
    const results = await svc.search({ claimText: 'claim', category: 'external_fact', maxSources: 5 });
    expect(results).toEqual([]);
  });

  it('normalizes citations and classifies reliability', async () => {
    const outputText = 'Some reference text from the model response.';
    const raw = makeCitationRaw([
      {
        url: 'https://who.int/article',
        title: 'WHO Article',
        start_index: 0,
        end_index: 4,
      },
      {
        url: 'https://bbc.com/news/article',
        title: 'BBC News',
        start_index: 5,
        end_index: 9,
      },
    ]);

    const gateway = makeGateway({
      outputText,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw,
    });
    const svc = new DefaultFactCheckSourceSearchService(
      makeEnvService(),
      gateway,
      makeLoggerFactory()
    );
    const results = await svc.search({ claimText: 'claim', category: 'medical', maxSources: 5 });

    expect(results).toHaveLength(2);
    expect(results[0].url).toBe('https://who.int/article');
    expect(results[0].reliability).toBe('authoritative');
    expect(results[0].publisher).toBeNull();
    expect(results[1].url).toBe('https://bbc.com/news/article');
    expect(results[1].reliability).toBe('media');
  });

  it('caps results to maxSources', async () => {
    const raw = makeCitationRaw([
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
      { url: 'https://c.com', title: 'C' },
    ]);
    const gateway = makeGateway({
      outputText: '',
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw,
    });
    const svc = new DefaultFactCheckSourceSearchService(
      makeEnvService(),
      gateway,
      makeLoggerFactory()
    );
    const results = await svc.search({ claimText: 'claim', category: 'external_fact', maxSources: 2 });
    expect(results).toHaveLength(2);
  });

  it('classifies .gov domains as primary', async () => {
    const raw = makeCitationRaw([{ url: 'https://cdc.gov/page', title: 'CDC' }]);
    const gateway = makeGateway({
      outputText: '',
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw,
    });
    const svc = new DefaultFactCheckSourceSearchService(
      makeEnvService(),
      gateway,
      makeLoggerFactory()
    );
    const results = await svc.search({ claimText: 'claim', category: 'medical', maxSources: 5 });
    expect(results[0].reliability).toBe('primary');
  });

  it('classifies unknown domains as weak', async () => {
    const raw = makeCitationRaw([{ url: 'https://randomsite.xyz/page', title: 'Random' }]);
    const gateway = makeGateway({
      outputText: '',
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw,
    });
    const svc = new DefaultFactCheckSourceSearchService(
      makeEnvService(),
      gateway,
      makeLoggerFactory()
    );
    const results = await svc.search({ claimText: 'claim', category: 'external_fact', maxSources: 5 });
    expect(results[0].reliability).toBe('weak');
  });

  it('rethrows gateway errors', async () => {
    const gateway = {
      createResponse: vi.fn(async () => { throw new Error('API error'); }),
      parseChatCompletion: vi.fn(),
    } as unknown as AiGateway;
    const svc = new DefaultFactCheckSourceSearchService(
      makeEnvService(),
      gateway,
      makeLoggerFactory()
    );
    await expect(
      svc.search({ claimText: 'claim', category: 'external_fact', maxSources: 5 })
    ).rejects.toThrow('API error');
  });
});
