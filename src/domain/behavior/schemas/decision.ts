import { z } from 'zod';

import { behaviorActionSchema } from './actions';
import { toOpenAiJsonSchema } from './jsonSchema';
import { liveStatePatchSchema } from './patches';
import { confidenceSchema } from './primitives';

export const behaviorDecisionSchema = z.object({
  confidence: confidenceSchema,
  actions: z.array(behaviorActionSchema),
  statePatches: z.array(liveStatePatchSchema),
  safetyNotes: z.array(z.string()),
});

// Precomputed once at module load — static data, never regenerated per request.
// Consumed by the decideBehavior OpenAI call in Plan 02.
export const behaviorDecisionJsonSchema = toOpenAiJsonSchema(
  behaviorDecisionSchema,
  'BehaviorDecision'
);

export type BehaviorDecision = z.infer<typeof behaviorDecisionSchema>;
