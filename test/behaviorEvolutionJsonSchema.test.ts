import { describe, expect, it } from 'vitest';

import { stateEvolutionJsonSchema } from '../src/domain/behavior/schemas/evolution';

function assertStrict(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(assertStrict);
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.type === 'object' || ('properties' in obj && !('anyOf' in obj))) {
    expect(obj.additionalProperties).toBe(false);
  }
  Object.values(obj).forEach(assertStrict);
}

describe('stateEvolutionJsonSchema', () => {
  it('has the correct name and strict flag', () => {
    expect(stateEvolutionJsonSchema.name).toBe('StateEvolutionDecision');
    expect(stateEvolutionJsonSchema.strict).toBe(true);
  });

  it('whole-tree additionalProperties: false invariant (strict-compatible)', () => {
    assertStrict(stateEvolutionJsonSchema.schema);
  });

  it('schema has no oneOf (discriminated unions rewritten to anyOf)', () => {
    const json = JSON.stringify(stateEvolutionJsonSchema.schema);
    expect(json).not.toContain('"oneOf"');
  });

  it('schema has no stripped validation keywords', () => {
    const json = JSON.stringify(stateEvolutionJsonSchema.schema);
    for (const key of [
      '"minimum"',
      '"maximum"',
      '"minItems"',
      '"maxItems"',
      '"minLength"',
      '"maxLength"',
      '"$schema"',
    ]) {
      expect(json).not.toContain(key);
    }
  });

  it('schema includes evolutionPatches array with anyOf union variants', () => {
    const json = JSON.stringify(stateEvolutionJsonSchema.schema);
    expect(json).toContain('evolutionPatches');
    expect(json).toContain('anyOf');
    expect(json).toContain('personality.add_signal');
    expect(json).toContain('user.add_political_note');
    expect(json).toContain('user.contest_political_note');
  });
});
