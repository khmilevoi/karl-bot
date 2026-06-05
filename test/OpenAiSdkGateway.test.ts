import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  chatCreate,
  chatParse,
  responseCreate,
  embeddingsCreate,
  transcriptionCreate,
  openAiConstructor,
} = vi.hoisted(() => {
  const chatCreate = vi.fn();
  const chatParse = vi.fn();
  const responseCreate = vi.fn();
  const embeddingsCreate = vi.fn();
  const transcriptionCreate = vi.fn();
  const openAiConstructor = vi.fn(() => ({
    chat: {
      completions: {
        create: chatCreate,
        parse: chatParse,
      },
    },
    responses: { create: responseCreate },
    embeddings: { create: embeddingsCreate },
    audio: { transcriptions: { create: transcriptionCreate } },
  }));
  return {
    chatCreate,
    chatParse,
    responseCreate,
    embeddingsCreate,
    transcriptionCreate,
    openAiConstructor,
  };
});

vi.mock('openai', () => ({ default: openAiConstructor }));

import type { EnvService } from '../src/application/interfaces/env/EnvService';
import { OpenAiSdkGateway } from '../src/infrastructure/external/OpenAiSdkGateway';

function makeEnv(): EnvService {
  return { env: { OPENAI_KEY: 'test-key' } } as unknown as EnvService;
}

beforeEach(() => {
  chatCreate.mockReset();
  chatParse.mockReset();
  responseCreate.mockReset();
  embeddingsCreate.mockReset();
  transcriptionCreate.mockReset();
  openAiConstructor.mockClear();
});

describe('OpenAiSdkGateway', () => {
  it('creates one OpenAI client with the configured API key', async () => {
    new OpenAiSdkGateway(makeEnv());

    expect(openAiConstructor).toHaveBeenCalledTimes(1);
    expect(openAiConstructor).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  it('creates chat completions and normalizes chat usage', async () => {
    const raw = {
      model: 'gpt-test',
      choices: [{ message: { content: 'hello' } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };
    chatCreate.mockResolvedValue(raw);
    const gateway = new OpenAiSdkGateway(makeEnv());
    const messages = [{ role: 'user' as const, content: 'Hi' }];

    const result = await gateway.createChatCompletion({
      model: 'gpt-test',
      messages,
    });

    expect(chatCreate).toHaveBeenCalledWith({
      model: 'gpt-test',
      messages,
    });
    expect(result).toEqual({
      content: 'hello',
      model: 'gpt-test',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      raw,
    });
  });

  it('returns empty text and null usage for chat responses without content or usage', async () => {
    const raw = { model: 'gpt-test', choices: [{ message: {} }] };
    chatCreate.mockResolvedValue(raw);
    const gateway = new OpenAiSdkGateway(makeEnv());

    const result = await gateway.createChatCompletion({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.content).toBe('');
    expect(result.usage).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it('parses chat completions through parseable json_schema response format', async () => {
    const raw = {
      model: 'gpt-test',
      choices: [{ message: { parsed: { ok: true } } }],
      usage: {
        prompt_tokens: 7,
        completion_tokens: 3,
        total_tokens: 10,
      },
    };
    chatParse.mockResolvedValue(raw);
    const gateway = new OpenAiSdkGateway(makeEnv());
    const responseFormat = {
      name: 'sample',
      strict: true as const,
      schema: { type: 'object' },
    };
    const parse = vi.fn((content: string) => ({ content }));

    const result = await gateway.parseChatCompletion({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Hi' }],
      responseFormat,
      parse,
    });

    expect(chatParse).toHaveBeenCalledWith({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Hi' }],
      response_format: expect.objectContaining({
        type: 'json_schema',
        json_schema: responseFormat,
      }),
    });
    expect(result).toEqual({
      parsed: { ok: true },
      model: 'gpt-test',
      usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
      raw,
    });
  });

  it('returns null when parsed chat completion has no parsed message', async () => {
    const raw = { model: 'gpt-test', choices: [{ message: {} }] };
    chatParse.mockResolvedValue(raw);
    const gateway = new OpenAiSdkGateway(makeEnv());

    const result = await gateway.parseChatCompletion({
      model: 'gpt-test',
      messages: [{ role: 'user', content: 'Hi' }],
      responseFormat: {
        name: 'sample',
        strict: true,
        schema: { type: 'object' },
      },
      parse: (content) => ({ content }),
    });

    expect(result.parsed).toBeNull();
    expect(result.usage).toEqual({
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
    });
  });

  it('creates Responses API calls and normalizes responses usage', async () => {
    const raw = {
      output_text: 'searched answer',
      usage: {
        input_tokens: 11,
        output_tokens: 6,
        total_tokens: 17,
      },
    };
    responseCreate.mockResolvedValue(raw);
    const gateway = new OpenAiSdkGateway(makeEnv());
    const tools = [{ type: 'web_search_preview' }];

    const result = await gateway.createResponse({
      model: 'gpt-test',
      input: 'question',
      tools,
    });

    expect(responseCreate).toHaveBeenCalledWith({
      model: 'gpt-test',
      input: 'question',
      tools,
    });
    expect(result).toEqual({
      outputText: 'searched answer',
      usage: { promptTokens: 11, completionTokens: 6, totalTokens: 17 },
      raw,
    });
  });

  it('creates embeddings from copied readonly input and returns them by SDK index', async () => {
    embeddingsCreate.mockResolvedValue({
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
    });
    const gateway = new OpenAiSdkGateway(makeEnv());
    const texts: readonly string[] = Object.freeze(['a', 'b']);

    const result = await gateway.createEmbeddings({
      model: 'text-embedding-3-small',
      texts,
    });

    const call = embeddingsCreate.mock.calls[0][0] as { input: string[] };
    expect(call).toEqual({
      model: 'text-embedding-3-small',
      input: ['a', 'b'],
    });
    expect(call.input).not.toBe(texts);
    expect(result).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('transcribes converted audio by converting it to a File and trimming text', async () => {
    transcriptionCreate.mockResolvedValue({ text: '  hello world  ' });
    const gateway = new OpenAiSdkGateway(makeEnv());
    const file = {
      filename: 'voice.webm',
      mimeType: 'audio/webm',
      buffer: Buffer.from('audio'),
    };

    const result = await gateway.transcribeAudio({
      model: 'gpt-4o-mini-transcribe',
      file,
    });

    expect(result).toBe('hello world');
    expect(transcriptionCreate).toHaveBeenCalledWith({
      model: 'gpt-4o-mini-transcribe',
      file: expect.any(File),
    });
  });
});
