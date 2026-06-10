import { describe, expect, it } from 'vitest';

import {
  claimExtractionResultJsonSchema,
  claimExtractionResultSchema,
  factVerificationResultJsonSchema,
  factVerificationResultSchema,
} from '../src/domain/fact-checking/FactCheckSchemas';

describe('fact-check structured output schemas', () => {
  it('parses extraction results with required fields', () => {
    const parsed = claimExtractionResultSchema.parse({
      claims: [
        {
          messageId: 10,
          claimText: 'The euro was introduced in 2000.',
          category: 'external_fact',
          needsExternalSources: true,
          riskLevel: 'low',
          whyCheckable: 'Specific historical date claim.',
          contextMessageIds: [],
        },
      ],
    });
    expect(parsed.claims).toHaveLength(1);
  });

  it('parses verification results and allows no_error', () => {
    const parsed = factVerificationResultSchema.parse({
      findings: [
        {
          messageId: 10,
          claimText: 'The euro was introduced in 2000.',
          status: 'confirmed',
          confidence: 0.91,
          correctedFact:
            'Euro banknotes and coins entered circulation in 2002.',
          explanation:
            'The claim confuses accounting introduction with cash circulation.',
          sourceRequirementsMet: true,
          sourceIndexes: [0],
          shouldNotifyImmediately: false,
        },
      ],
    });
    expect(parsed.findings[0]?.status).toBe('confirmed');
  });

  it('emits strict OpenAI-compatible JSON schemas', () => {
    expect(claimExtractionResultJsonSchema.strict).toBe(true);
    expect(factVerificationResultJsonSchema.strict).toBe(true);
    expect(JSON.stringify(claimExtractionResultJsonSchema)).not.toContain(
      '"maximum"'
    );

    const assertStrictObjects = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(assertStrictObjects);
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.type === 'object' && obj.properties != null) {
        const props = Object.keys(obj.properties as Record<string, unknown>);
        const required = (obj.required as string[] | undefined) ?? [];
        expect([...required].sort()).toEqual([...props].sort());
        expect(obj.additionalProperties).toBe(false);
      }
      Object.values(obj).forEach(assertStrictObjects);
    };

    assertStrictObjects(claimExtractionResultJsonSchema.schema);
    assertStrictObjects(factVerificationResultJsonSchema.schema);
  });
});
