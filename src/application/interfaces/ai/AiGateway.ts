import type { ServiceIdentifier } from 'inversify';

import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import type { ConvertedAudioFile } from '@/application/interfaces/voice/AudioConversionService';
import type { AiResponseFormatSchema } from '@/domain/behavior/schemas/jsonSchema';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface AiTextResult {
  content: string;
  model: AiModelId;
  usage: AiUsage;
  raw: unknown;
}

export interface AiParsedResult<T> {
  parsed: T | null;
  model: AiModelId;
  usage: AiUsage;
  raw: unknown;
}

export interface AiResponseResult {
  outputText: string;
  usage: AiUsage;
  raw: unknown;
}

export interface AiGateway {
  createChatCompletion(input: {
    model: AiModelId;
    messages: AiMessage[];
  }): Promise<AiTextResult>;

  parseChatCompletion<T>(input: {
    model: AiModelId;
    messages: AiMessage[];
    responseFormat: AiResponseFormatSchema;
    parse: (content: string) => T;
  }): Promise<AiParsedResult<T>>;

  createResponse(input: {
    model: AiModelId;
    input: string;
    tools: unknown[];
  }): Promise<AiResponseResult>;

  createEmbeddings(input: {
    model: AiModelId;
    texts: readonly string[];
  }): Promise<number[][]>;

  transcribeAudio(input: {
    model: AiModelId;
    file: ConvertedAudioFile;
  }): Promise<string>;
}

export const AI_GATEWAY_ID = Symbol.for(
  'AiGateway'
) as ServiceIdentifier<AiGateway>;
