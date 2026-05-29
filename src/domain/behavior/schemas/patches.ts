import { z } from 'zod';

import { intensitySchema, patchEvidenceSchema } from './primitives';

// --- User profile patches (live lane) ---

export const userAdjustAffinityPatchSchema = z.object({
  type: z.literal('user.adjust_affinity'),
  userId: z.number().int(),
  delta: z.union([z.literal(-1), z.literal(1)]),
  evidence: patchEvidenceSchema,
});

export const userAddLabelPatchSchema = z.object({
  type: z.literal('user.add_label'),
  userId: z.number().int(),
  label: z.string(),
  evidence: patchEvidenceSchema,
});

export const userAddPatternPatchSchema = z.object({
  type: z.literal('user.add_pattern'),
  userId: z.number().int(),
  polarity: z.enum(['positive', 'negative', 'neutral']),
  text: z.string(),
  evidence: patchEvidenceSchema,
});

export const userAddGrudgePatchSchema = z.object({
  type: z.literal('user.add_grudge'),
  userId: z.number().int(),
  text: z.string(),
  evidence: patchEvidenceSchema,
});

export const userContestProfileSignalPatchSchema = z.object({
  type: z.literal('user.contest_profile_signal'),
  userId: z.number().int(),
  target: z.object({
    kind: z.enum(['label', 'pattern', 'grudge']),
    text: z.string(),
  }),
  evidence: patchEvidenceSchema,
});

export const userProfilePatchSchema = z.discriminatedUnion('type', [
  userAdjustAffinityPatchSchema,
  userAddLabelPatchSchema,
  userAddPatternPatchSchema,
  userAddGrudgePatchSchema,
  userContestProfileSignalPatchSchema,
]);

// --- Truth patches (live lane) ---

export const truthAddPatchSchema = z.object({
  type: z.literal('truth.add'),
  text: z.string(),
  relatedTruthIds: z.array(z.number().int()),
  contradictsTruthIds: z.array(z.number().int()),
  evidence: patchEvidenceSchema,
});

export const truthReinforcePatchSchema = z.object({
  type: z.literal('truth.reinforce'),
  truthId: z.number().int(),
  evidence: patchEvidenceSchema,
});

export const truthContestPatchSchema = z.object({
  type: z.literal('truth.contest'),
  truthId: z.number().int(),
  counterText: z.string(),
  evidence: patchEvidenceSchema,
});

export const truthRevisePatchSchema = z.object({
  type: z.literal('truth.revise'),
  truthId: z.number().int(),
  revisedText: z.string(),
  evidence: patchEvidenceSchema,
});

export const truthPatchSchema = z.discriminatedUnion('type', [
  truthAddPatchSchema,
  truthReinforcePatchSchema,
  truthContestPatchSchema,
  truthRevisePatchSchema,
]);

export const liveStatePatchSchema = z.discriminatedUnion('type', [
  userAdjustAffinityPatchSchema,
  userAddLabelPatchSchema,
  userAddPatternPatchSchema,
  userAddGrudgePatchSchema,
  userContestProfileSignalPatchSchema,
  truthAddPatchSchema,
  truthReinforcePatchSchema,
  truthContestPatchSchema,
  truthRevisePatchSchema,
]);

// --- Evolution patches (background pass; not in the live schema) ---

export const personalityPatchSchema = z.object({
  type: z.literal('personality.add_signal'),
  area: z.enum([
    'identity',
    'values',
    'speech_style',
    'social_habits',
    'themes',
  ]),
  polarity: z.enum(['reinforce', 'contest', 'soften']),
  text: z.string(),
  evidence: patchEvidenceSchema,
});

export const politicsAddPositionPatchSchema = z.object({
  type: z.literal('politics.add_position'),
  topic: z.string(),
  stance: z.string(),
  requestedIntensity: intensitySchema,
  evidence: patchEvidenceSchema,
});

export const politicsAdjustPositionPatchSchema = z.object({
  type: z.literal('politics.adjust_position'),
  positionId: z.number().int(),
  direction: z.enum(['radicalize', 'soften', 'contest', 'reverse']),
  evidence: patchEvidenceSchema,
});

export const politicsAddUncertaintyPatchSchema = z.object({
  type: z.literal('politics.add_uncertainty'),
  topic: z.string(),
  summary: z.string(),
  evidence: patchEvidenceSchema,
});

export const politicalPatchSchema = z.discriminatedUnion('type', [
  politicsAddPositionPatchSchema,
  politicsAdjustPositionPatchSchema,
  politicsAddUncertaintyPatchSchema,
]);

export const evolutionPatchSchema = z.discriminatedUnion('type', [
  personalityPatchSchema,
  politicsAddPositionPatchSchema,
  politicsAdjustPositionPatchSchema,
  politicsAddUncertaintyPatchSchema,
]);

export type UserProfilePatch = z.infer<typeof userProfilePatchSchema>;
export type TruthPatch = z.infer<typeof truthPatchSchema>;
export type LiveStatePatch = z.infer<typeof liveStatePatchSchema>;
export type PersonalityPatch = z.infer<typeof personalityPatchSchema>;
export type PoliticalPatch = z.infer<typeof politicalPatchSchema>;
export type EvolutionPatch = z.infer<typeof evolutionPatchSchema>;
