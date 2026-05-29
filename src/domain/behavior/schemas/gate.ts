import { z } from 'zod';

import { toOpenAiJsonSchema } from './jsonSchema';
import {
  confidenceSchema,
  messageIdSchema,
  stateImpactRiskSchema,
} from './primitives';

export const gateReasonSchema = z.enum([
  'direct_trigger',
  'conflict',
  'strong_emotion',
  'political_claim',
  'attitude_to_carl',
  'user_relationship_signal',
  'group_truth_candidate',
  'personality_signal',
  'not_relevant',
]);

export const behaviorGateDecisionSchema = z.object({
  shouldDecide: z.boolean(),
  confidence: confidenceSchema,
  reason: gateReasonSchema,
  triggerMessageIds: z.array(messageIdSchema),
  contextMessageIds: z.array(messageIdSchema),
  stateImpactRisk: stateImpactRiskSchema,
});

// Precomputed once at module load — static data, never regenerated per request.
export const behaviorGateJsonSchema = toOpenAiJsonSchema(
  behaviorGateDecisionSchema,
  'BehaviorGateDecision'
);

export type GateReason = z.infer<typeof gateReasonSchema>;
export type BehaviorGateDecision = z.infer<typeof behaviorGateDecisionSchema>;
