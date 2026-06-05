import { inject, injectable } from 'inversify';
import OpenAI from 'openai';
import { makeParseableResponseFormat } from 'openai/lib/parser';

import type {
  OpenAiMessage,
  OpenAiGateway,
  OpenAiParsedResult,
  OpenAiResponseResult,
  OpenAiTextResult,
  OpenAiUsage,
} from '@/application/interfaces/ai/OpenAiGateway';
import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import type { OpenAiResponseFormatSchema } from '@/domain/behavior/schemas/jsonSchema';

type SdkUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

@injectable()
export class OpenAiSdkGateway implements OpenAiGateway {
  private readonly client: OpenAI;

  constructor(@inject(ENV_SERVICE_ID) envService: EnvService) {
    this.client = new OpenAI({ apiKey: envService.env.OPENAI_KEY });
  }

  async createChatCompletion(
    input: Parameters<OpenAiGateway['createChatCompletion']>[0]
  ): Promise<OpenAiTextResult> {
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

  async parseChatCompletion<T>(
    input: {
      model: AiModelId;
      messages: OpenAiMessage[];
      responseFormat: OpenAiResponseFormatSchema;
      parse: (content: string) => T;
    }
  ): Promise<OpenAiParsedResult<T>> {
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
    input: Parameters<OpenAiGateway['createResponse']>[0]
  ): Promise<OpenAiResponseResult> {
    const params = {
      model: input.model,
      input: input.input,
      tools: input.tools,
    } as unknown as Parameters<OpenAI['responses']['create']>[0];
    const response = await this.client.responses.create(params);
    return {
      outputText: response.output_text,
      usage: this.normalizeUsage(response.usage),
      raw: response,
    };
  }

  async createEmbeddings(
    input: Parameters<OpenAiGateway['createEmbeddings']>[0]
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
    input: Parameters<OpenAiGateway['transcribeAudio']>[0]
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

  private normalizeUsage(usage: SdkUsage | null | undefined): OpenAiUsage {
    return {
      promptTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? null,
      completionTokens:
        usage?.completion_tokens ?? usage?.output_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
    };
  }
}
