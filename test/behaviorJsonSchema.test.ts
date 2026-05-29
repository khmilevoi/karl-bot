import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { toOpenAiJsonSchema } from '../src/domain/behavior/schemas/jsonSchema';

describe('toOpenAiJsonSchema', () => {
  it('wraps a schema in a strict named response format (full result)', () => {
    const schema = z.object({ a: z.string(), b: z.number().nullable() });
    expect(toOpenAiJsonSchema(schema, 'sample')).toEqual({
      name: 'sample',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
        required: ['a', 'b'],
        additionalProperties: false,
      },
    });
  });

  it('rewrites discriminated-union oneOf to anyOf (full schema)', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), x: z.number() }),
      z.object({ type: z.literal('b'), y: z.string().nullable() }),
    ]);
    expect(toOpenAiJsonSchema(schema, 'u').schema).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'a' },
            x: { type: 'number' },
          },
          required: ['type', 'x'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'b' },
            y: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: ['type', 'y'],
          additionalProperties: false,
        },
      ],
    });
  });

  it('strips the root $schema while keeping nested objects intact (full schema)', () => {
    const schema = z.object({ nested: z.object({ a: z.string() }) });
    expect(toOpenAiJsonSchema(schema, 'n').schema).toEqual({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
          additionalProperties: false,
        },
      },
      required: ['nested'],
      additionalProperties: false,
    });
  });

  it('strips validation keywords OpenAI strict rejects (full schema)', () => {
    const schema = z.object({
      c: z.number().min(0).max(1),
      ids: z.array(z.number().int()).min(1),
    });
    expect(toOpenAiJsonSchema(schema, 's').schema).toEqual({
      type: 'object',
      properties: {
        c: { type: 'number' },
        ids: { type: 'array', items: { type: 'integer' } },
      },
      required: ['c', 'ids'],
      additionalProperties: false,
    });
  });
});
