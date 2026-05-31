import { z } from 'zod';

import { toOpenAiJsonSchema } from './jsonSchema';
import { evolutionPatchSchema } from './patches';
import { messageIdSchema } from './primitives';
import { politicalCompassSchema, speechStyleSchema } from './state';

export const personalitySnapshotSchema = z.object({
  identityNotes: z.array(z.string()),
  values: z.array(z.string()),
  speechStyle: speechStyleSchema,
  socialHabits: z.array(z.string()),
  recurringThemes: z.array(z.string()),
});

export const userProfileSnapshotSchema = z.object({
  userId: messageIdSchema,
  communicationStyle: z.string(),
  conflictStyle: z.string(),
  preferredTone: z.string(),
  interests: z.array(z.string()),
});

export const userCompassSnapshotSchema = z.object({
  userId: messageIdSchema,
  compass: politicalCompassSchema,
});

export const stateEvolutionDecisionSchema = z.object({
  evolutionPatches: z.array(evolutionPatchSchema),
  personalitySnapshot: personalitySnapshotSchema,
  userSnapshots: z.array(userProfileSnapshotSchema),
  botCompass: politicalCompassSchema,
  userPoliticalSnapshots: z.array(userCompassSnapshotSchema),
});

export const stateEvolutionJsonSchema = toOpenAiJsonSchema(
  stateEvolutionDecisionSchema,
  'StateEvolutionDecision'
);

export type PersonalitySnapshot = z.infer<typeof personalitySnapshotSchema>;
export type UserProfileSnapshot = z.infer<typeof userProfileSnapshotSchema>;
export type UserCompassSnapshot = z.infer<typeof userCompassSnapshotSchema>;
export type StateEvolutionDecision = z.infer<
  typeof stateEvolutionDecisionSchema
>;
