import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { ExtractedClaim } from '@/domain/fact-checking/FactCheckTypes';

// Structurally compatible with SourceSearchResult (Task 8). Defined here so the
// prompt layer does not depend on the source-search service.
export interface FactCheckPromptSource {
  url: string;
  title: string;
  publisher: string | null;
  snippet: string;
  reliability: string;
}

export interface FactCheckExtractionPromptContext {
  batchMessages: ChatMessage[];
  contextMessages: ChatMessage[];
}

export interface FactCheckVerificationPromptContext {
  candidates: ExtractedClaim[];
  batchMessages: ChatMessage[];
  contextMessages: ChatMessage[];
  sources: FactCheckPromptSource[];
}
