import { inject, injectable } from 'inversify';
import OpenAI from 'openai';
import { makeParseableResponseFormat } from 'openai/lib/parser';
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';

import type {
  AiMessage,
  AiGateway,
  AiParsedResult,
  AiResponseResult,
  AiTextResult,
  AiUsage,
} from '@/application/interfaces/ai/AiGateway';
import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import type { AiResponseFormatSchema } from '@/domain/behavior/schemas/jsonSchema';

type SdkUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

@injectable()
export class OpenAiSdkGateway implements AiGateway {
  private readonly client: OpenAI;

  constructor(@inject(ENV_SERVICE_ID) envService: EnvService) {
    this.client = new OpenAI({ apiKey: envService.env.OPENAI_KEY });
  }

  async createChatCompletion(
    input: Parameters<AiGateway['createChatCompletion']>[0]
  ): Promise<AiTextResult> {
    const response = await this.client.chat.completions.create({
      model: input.model,
      messages: input.messages,
    });
    return {
      content: response.choices[0]?.message?.content ?? '',
      model: response.model,
      usage: this.normalizeUsage(response.usage),
      raw: response,
    };
  }

  async parseChatCompletion<T>(input: {
    model: AiModelId;
    messages: AiMessage[];
    responseFormat: AiResponseFormatSchema;
    parse: (content: string) => T;
  }): Promise<AiParsedResult<T>> {
    const responseFormat = makeParseableResponseFormat(
      {
        type: 'json_schema',
        json_schema: input.responseFormat,
      },
      input.parse
    );
    const response = await this.client.chat.completions.parse({
      model: input.model,
      messages: input.messages,
      response_format: responseFormat,
    });
    return {
      parsed: response.choices[0]?.message?.parsed ?? null,
      model: response.model,
      usage: this.normalizeUsage(response.usage),
      raw: response,
    };
  }

  async createResponse(
    input: Parameters<AiGateway['createResponse']>[0]
  ): Promise<AiResponseResult> {
    const params: ResponseCreateParamsNonStreaming = {
      model: input.model,
      input: input.input,
      tools:
        input.tools as unknown as ResponseCreateParamsNonStreaming['tools'],
    };
    const response: Response = await this.client.responses.create(params);
    return {
      outputText: response.output_text,
      usage: this.normalizeUsage(response.usage),
      raw: response,
    };
  }

  async createEmbeddings(
    input: Parameters<AiGateway['createEmbeddings']>[0]
  ): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: input.model,
      input: [...input.texts],
    });
    return [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  async transcribeAudio(
    input: Parameters<AiGateway['transcribeAudio']>[0]
  ): Promise<string> {
    const arrayBuffer = input.file.buffer.buffer.slice(
      input.file.buffer.byteOffset,
      input.file.buffer.byteOffset + input.file.buffer.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: input.file.mimeType });
    const file = new File([blob], input.file.filename, {
      type: input.file.mimeType,
    });

    const result = await this.client.audio.transcriptions.create({
      model: input.model,
      file,
    });
    return result.text.trim();
  }

  private normalizeUsage(usage: SdkUsage | null | undefined): AiUsage {
    return {
      promptTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? null,
      completionTokens:
        usage?.completion_tokens ?? usage?.output_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
    };
  }
}
