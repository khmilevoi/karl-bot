import type { ZodType } from 'zod';
import { z } from 'zod';

export interface AiResponseFormatSchema {
  name: string;
  strict: true;
  schema: Record<string, unknown>;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// OpenAI strict structured output supports only a limited keyword set. Zod v4
// emits validation keywords strict mode rejects — numeric ranges (even
// `z.number().int()` adds huge minimum/maximum bounds), string/array length,
// pattern/format. Drop them here; these bounds are re-enforced in
// BehaviorDecisionValidator, which parses against the full Zod schema.
const STRIP_KEYS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'default',
]);

// In addition to stripping the keys above, unions must use `anyOf` rather than
// the `oneOf` Zod emits for discriminated unions.
function normalize(node: JsonValue): JsonValue {
  if (Array.isArray(node)) {
    return node.map(normalize);
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }

  const result: { [key: string]: JsonValue } = {};
  for (const [key, value] of Object.entries(node)) {
    if (STRIP_KEYS.has(key)) {
      continue;
    }
    const outKey = key === 'oneOf' ? 'anyOf' : key;
    result[outKey] = normalize(value);
  }
  return result;
}

export function toOpenAiJsonSchema(
  schema: ZodType,
  name: string
): AiResponseFormatSchema {
  const raw = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
  }) as unknown as JsonValue;
  const normalized = normalize(raw) as Record<string, unknown>;
  return { name, strict: true, schema: normalized };
}
