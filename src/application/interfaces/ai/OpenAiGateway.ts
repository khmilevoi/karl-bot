import type { ServiceIdentifier } from 'inversify';

import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import type { ConvertedAudioFile } from '@/application/interfaces/voice/AudioConversionService';
import type { OpenAiResponseFormatSchema } from '@/domain/behavior/schemas/jsonSchema';

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAiUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface OpenAiTextResult {
  content: string;
  model: AiModelId;
  usage: OpenAiUsage;
  raw: unknown;
}

export interface OpenAiParsedResult<T> {
  parsed: T | null;
  model: AiModelId;
  usage: OpenAiUsage;
  raw: unknown;
}

export interface OpenAiResponseResult {
  outputText: string;
  usage: OpenAiUsage;
  raw: unknown;
}

export interface OpenAiGateway {
  createChatCompletion(input: {
    model: AiModelId;
    messages: OpenAiMessage[];
  }): Promise<OpenAiTextResult>;

  parseChatCompletion<T>(input: {
    model: AiModelId;
    messages: OpenAiMessage[];
    responseFormat: OpenAiResponseFormatSchema;
    parse: (content: string) => T;
  }): Promise<OpenAiParsedResult<T>>;

  createResponse(input: {
    model: AiModelId;
    input: string;
    tools: unknown[];
  }): Promise<OpenAiResponseResult>;

  createEmbeddings(input: {
    model: AiModelId;
    texts: readonly string[];
  }): Promise<number[][]>;

  transcribeAudio(input: {
    model: AiModelId;
    file: ConvertedAudioFile;
  }): Promise<string>;
}

export const OPEN_AI_GATEWAY_ID = Symbol.for(
  'OpenAiGateway'
) as ServiceIdentifier<OpenAiGateway>;
