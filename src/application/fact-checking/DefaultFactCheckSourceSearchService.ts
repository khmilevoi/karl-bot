import { inject, injectable } from 'inversify';

import {
  AI_GATEWAY_ID,
  type AiGateway,
} from '@/application/interfaces/ai/AiGateway';
import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type { FactCheckSourceReliability } from '@/domain/fact-checking/FactCheckTypes';

import type {
  SourceSearchRequest,
  SourceSearchResult,
  SourceSearchService,
} from './SourceSearchService';

interface UrlCitation {
  url: string;
  title: string;
  startIndex: number;
  endIndex: number;
}

export function extractUrlCitations(raw: unknown): UrlCitation[] {
  if (raw == null || typeof raw !== 'object') return [];
  const response = raw as Record<string, unknown>;
  const output = Array.isArray(response['output']) ? response['output'] : [];
  const citations: UrlCitation[] = [];

  for (const item of output) {
    if (
      item == null ||
      typeof item !== 'object' ||
      (item as Record<string, unknown>)['type'] !== 'message'
    ) {
      continue;
    }
    const content = (item as Record<string, unknown>)['content'];
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (
        block == null ||
        typeof block !== 'object' ||
        (block as Record<string, unknown>)['type'] !== 'output_text'
      ) {
        continue;
      }
      const annotations = (block as Record<string, unknown>)['annotations'];
      if (!Array.isArray(annotations)) continue;

      for (const annotation of annotations) {
        if (
          annotation == null ||
          typeof annotation !== 'object' ||
          (annotation as Record<string, unknown>)['type'] !== 'url_citation'
        ) {
          continue;
        }
        const a = annotation as Record<string, unknown>;
        const url = typeof a['url'] === 'string' ? a['url'] : null;
        const title = typeof a['title'] === 'string' ? a['title'] : '';
        const startIndex =
          typeof a['start_index'] === 'number' ? a['start_index'] : 0;
        const endIndex =
          typeof a['end_index'] === 'number' ? a['end_index'] : 0;
        if (url != null) {
          citations.push({ url, title, startIndex, endIndex });
        }
      }
    }
  }

  return citations;
}

function classifyReliability(url: string): FactCheckSourceReliability {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.endsWith('.gov') || hostname.endsWith('.edu')) {
      return 'primary';
    }
    const authoritative = [
      'who.int',
      'un.org',
      'ec.europa.eu',
      'eur-lex.europa.eu',
      'pubmed.ncbi.nlm.nih.gov',
      'ncbi.nlm.nih.gov',
      'scholar.google.com',
      'wikipedia.org',
      'britannica.com',
    ];
    if (
      authoritative.some((d) => hostname === d || hostname.endsWith(`.${d}`))
    ) {
      return 'authoritative';
    }
    const media = [
      'bbc.com',
      'bbc.co.uk',
      'reuters.com',
      'apnews.com',
      'nytimes.com',
      'theguardian.com',
      'washingtonpost.com',
      'bloomberg.com',
      'ft.com',
      'lemonde.fr',
      'spiegel.de',
      'rbc.ru',
      'vedomosti.ru',
      'kommersant.ru',
    ];
    if (media.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
      return 'media';
    }
  } catch {
    // unparseable URL
  }
  return 'weak';
}

@injectable()
export class DefaultFactCheckSourceSearchService implements SourceSearchService {
  private readonly sourceSearchModel: AiModelId;
  private readonly logger: Logger;

  constructor(
    @inject(ENV_SERVICE_ID) private readonly envService: EnvService,
    @inject(AI_GATEWAY_ID) private readonly gateway: AiGateway,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.sourceSearchModel = envService.getModels().sourceSearch.default;
    this.logger = loggerFactory.create('DefaultFactCheckSourceSearchService');
  }

  async search(request: SourceSearchRequest): Promise<SourceSearchResult[]> {
    const prompt = `Find factual sources for this claim from the category "${request.category}":\n\n"${request.claimText}"\n\nReturn concise references with their URLs.`;

    let result;
    try {
      result = await this.gateway.createResponse({
        model: this.sourceSearchModel,
        input: prompt,
        tools: [{ type: 'web_search_preview' }],
      });
    } catch (err) {
      this.logger.error({ err }, 'Source search API call failed');
      throw err;
    }

    const citations = extractUrlCitations(result.raw);
    const now = new Date().toISOString();

    return citations.slice(0, request.maxSources).map((citation) => {
      const snippet =
        citation.endIndex > citation.startIndex
          ? result.outputText
              .slice(citation.startIndex, citation.endIndex)
              .trim()
          : '';
      return {
        url: citation.url,
        title: citation.title || citation.url,
        publisher: null,
        snippet,
        reliability: classifyReliability(citation.url),
        retrievedAt: now,
      };
    });
  }
}
