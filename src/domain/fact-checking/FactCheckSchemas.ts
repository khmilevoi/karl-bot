import { z } from 'zod';

import { toOpenAiJsonSchema } from '@/domain/behavior/schemas/jsonSchema';

export const factCheckCategorySchema = z.enum([
  'external_fact',
  'chat_history',
  'medical',
  'legal',
  'financial',
  'safety',
  'mixed',
]);

export const factCheckSeveritySchema = z.enum(['low', 'medium', 'high']);
export const factCheckStatusSchema = z.enum(['confirmed', 'uncertain']);
export const factCheckVerificationStatusSchema = z.enum([
  'confirmed',
  'uncertain',
  'no_error',
]);
export const factCheckSourceReliabilitySchema = z.enum([
  'primary',
  'authoritative',
  'media',
  'weak',
]);

const confidenceSchema = z.number().min(0).max(1);
const messageIdSchema = z.number().int().positive();

export const extractedClaimSchema = z.object({
  messageId: messageIdSchema,
  claimText: z.string(),
  category: factCheckCategorySchema,
  needsExternalSources: z.boolean(),
  riskLevel: factCheckSeveritySchema,
  whyCheckable: z.string(),
  contextMessageIds: z.array(messageIdSchema),
});

export const claimExtractionResultSchema = z.object({
  claims: z.array(extractedClaimSchema),
});

export const verificationFindingSchema = z.object({
  messageId: messageIdSchema,
  claimText: z.string(),
  status: factCheckVerificationStatusSchema,
  confidence: confidenceSchema,
  correctedFact: z.string(),
  explanation: z.string(),
  sourceRequirementsMet: z.boolean(),
  sourceIndexes: z.array(z.number().int().nonnegative()),
  shouldNotifyImmediately: z.boolean(),
});

export const factVerificationResultSchema = z.object({
  findings: z.array(verificationFindingSchema),
});

export const claimExtractionResultJsonSchema = toOpenAiJsonSchema(
  claimExtractionResultSchema,
  'FactCheckClaimExtraction'
);

export const factVerificationResultJsonSchema = toOpenAiJsonSchema(
  factVerificationResultSchema,
  'FactCheckVerification'
);

export type ClaimExtractionResult = z.infer<typeof claimExtractionResultSchema>;
export type FactVerificationResult = z.infer<typeof factVerificationResultSchema>;
