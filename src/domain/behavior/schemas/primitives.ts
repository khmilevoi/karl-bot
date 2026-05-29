import { z } from 'zod';

export const confidenceSchema = z.number().min(0).max(1);

// Evidence message IDs reference the bot's own message store (messages.id),
// not the nullable Telegram message_id.
export const messageIdSchema = z.number().int();

export const patchEvidenceSchema = z.object({
  messageIds: z.array(messageIdSchema),
  summary: z.string(),
  confidence: confidenceSchema,
});

export const stateImpactRiskSchema = z.enum(['none', 'low', 'medium', 'high']);

export const intensitySchema = z.enum([
  'weak',
  'moderate',
  'strong',
  'radical',
]);

export const signalStatusSchema = z.enum(['active', 'contested', 'inactive']);

export type PatchEvidence = z.infer<typeof patchEvidenceSchema>;
export type StateImpactRisk = z.infer<typeof stateImpactRiskSchema>;
