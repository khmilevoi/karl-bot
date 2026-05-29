import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { behaviorDecisionJsonSchema } from '../src/domain/behavior/schemas/decision';
import { behaviorGateJsonSchema } from '../src/domain/behavior/schemas/gate';
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

function assertStrict(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(assertStrict);
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const obj = node as Record<string, unknown>;
  expect('oneOf' in obj).toBe(false);
  expect('$schema' in obj).toBe(false);
  expect('minimum' in obj).toBe(false);
  expect('maximum' in obj).toBe(false);
  expect('minItems' in obj).toBe(false);
  if (obj.type === 'object' && 'properties' in obj) {
    expect(obj.additionalProperties).toBe(false);
    const propKeys = Object.keys(obj.properties as Record<string, unknown>);
    expect(new Set(obj.required as string[])).toEqual(new Set(propKeys));
  }
  Object.values(obj).forEach(assertStrict);
}

describe('precomputed behavior contract JSON schemas', () => {
  it('precomputes the exact gate schema (full equality)', () => {
    expect(behaviorGateJsonSchema.name).toBe('BehaviorGateDecision');
    expect(behaviorGateJsonSchema.strict).toBe(true);
    expect(behaviorGateJsonSchema.schema).toEqual({
      type: 'object',
      properties: {
        shouldDecide: { type: 'boolean' },
        confidence: { type: 'number' },
        reason: {
          type: 'string',
          enum: [
            'direct_trigger',
            'conflict',
            'strong_emotion',
            'political_claim',
            'attitude_to_carl',
            'user_relationship_signal',
            'group_truth_candidate',
            'personality_signal',
            'not_relevant',
          ],
        },
        triggerMessageIds: { type: 'array', items: { type: 'integer' } },
        contextMessageIds: { type: 'array', items: { type: 'integer' } },
        stateImpactRisk: {
          type: 'string',
          enum: ['none', 'low', 'medium', 'high'],
        },
      },
      required: [
        'shouldDecide',
        'confidence',
        'reason',
        'triggerMessageIds',
        'contextMessageIds',
        'stateImpactRisk',
      ],
      additionalProperties: false,
    });
  });

  it('precomputes a strict-compatible BehaviorDecision schema (whole-tree invariants)', () => {
    expect(behaviorDecisionJsonSchema.name).toBe('BehaviorDecision');
    expect(behaviorDecisionJsonSchema.strict).toBe(true);
    assertStrict(behaviorDecisionJsonSchema.schema);
  });
});
