import { z } from 'zod';

import {
  confidenceSchema,
  messageIdSchema,
  signalStatusSchema,
} from './primitives';

export const socialSignalSchema = z.object({
  text: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  status: signalStatusSchema,
});

export const patternSignalSchema = z.object({
  polarity: z.enum(['positive', 'negative', 'neutral']),
  text: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  status: signalStatusSchema,
});

export const speechStyleSchema = z.object({
  tone: z.string(),
  humor: z.string(),
  verbosity: z.enum(['short', 'medium', 'essay']),
  formality: z.enum(['low', 'medium', 'high']),
});

export const botPersonalityStateSchema = z.object({
  chatId: z.number().int(),
  identityNotes: z.array(z.string()),
  values: z.array(z.string()),
  speechStyle: speechStyleSchema,
  socialHabits: z.array(z.string()),
  recurringThemes: z.array(z.string()),
  lastUpdatedAt: z.string(),
});

export const politicalPositionSchema = z.object({
  id: z.number().int(),
  topic: z.string(),
  stance: z.string(),
  intensity: z.enum(['weak', 'moderate', 'strong', 'radical']),
  confidence: confidenceSchema,
  status: z.enum(['active', 'contested', 'softened', 'reversed']),
  evidenceMessageIds: z.array(messageIdSchema),
  opposingEvidenceMessageIds: z.array(messageIdSchema),
  origin: z.enum(['chat_discussion', 'bot_reflection']),
  updatedAt: z.string(),
});

export const politicalInfluenceSchema = z.object({
  source: z.enum(['chat_discussion', 'bot_reflection']),
  summary: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  confidence: confidenceSchema,
  createdAt: z.string(),
});

export const personalitySignalSchema = z.object({
  area: z.enum([
    'identity',
    'values',
    'speech_style',
    'social_habits',
    'themes',
  ]),
  polarity: z.enum(['reinforce', 'contest', 'soften']),
  text: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  status: signalStatusSchema,
  createdAt: z.string(),
});

export const politicalCompassSchema = z.object({
  economic: z.number(),
  social: z.number(),
  economicConfidence: z.number(),
  socialConfidence: z.number(),
});

export const politicalNoteSchema = z.object({
  text: z.string(),
  evidenceMessageIds: z.array(messageIdSchema),
  status: signalStatusSchema,
});

export const userPoliticalProfileSchema = z.object({
  userId: z.number().int(),
  chatId: z.number().int(),
  notes: z.array(politicalNoteSchema),
  compass: politicalCompassSchema,
  updatedAt: z.string(),
});

export type PersonalitySignal = z.infer<typeof personalitySignalSchema>;
export type PoliticalCompass = z.infer<typeof politicalCompassSchema>;
export type PoliticalNote = z.infer<typeof politicalNoteSchema>;
export type UserPoliticalProfile = z.infer<typeof userPoliticalProfileSchema>;

export const botPoliticalStateSchema = z.object({
  chatId: z.number().int(),
  ideologySummary: z.string(),
  positions: z.array(politicalPositionSchema),
  uncertaintyAreas: z.array(z.string()),
  influenceHistory: z.array(politicalInfluenceSchema),
  compass: politicalCompassSchema,
  lastUpdatedAt: z.string(),
});

export const userSocialProfileSchema = z.object({
  userId: z.number().int(),
  chatId: z.number().int(),
  username: z.string().nullable(),
  affinityScore: z.number().int().gte(-3).lte(3),
  labels: z.array(socialSignalSchema),
  patterns: z.array(patternSignalSchema),
  grudges: z.array(socialSignalSchema),
  trustLevel: z.enum(['none', 'low', 'medium', 'high']),
  preferredDistance: z.enum([
    'warm',
    'neutral',
    'cold',
    'mocking',
    'avoidant',
    'hostile',
  ]),
  communicationStyle: z.string(),
  conflictStyle: z.string(),
  preferredTone: z.string(),
  interests: z.array(z.string()),
  updatedAt: z.string(),
});

export const botTruthSchema = z.object({
  id: z.number().int(),
  chatId: z.number().int(),
  text: z.string(),
  sourceMessageIds: z.array(messageIdSchema),
  confidence: confidenceSchema,
  relatedTruthIds: z.array(z.number().int()),
  contradictsTruthIds: z.array(z.number().int()),
  status: z.enum(['fresh', 'stable', 'contested', 'superseded']),
  createdAt: z.string(),
});

export type SocialSignal = z.infer<typeof socialSignalSchema>;
export type PatternSignal = z.infer<typeof patternSignalSchema>;
export type SpeechStyle = z.infer<typeof speechStyleSchema>;
export type BotPersonalityState = z.infer<typeof botPersonalityStateSchema>;
export type PoliticalPosition = z.infer<typeof politicalPositionSchema>;
export type PoliticalInfluence = z.infer<typeof politicalInfluenceSchema>;
export type BotPoliticalState = z.infer<typeof botPoliticalStateSchema>;
export type UserSocialProfile = z.infer<typeof userSocialProfileSchema>;
export type BotTruth = z.infer<typeof botTruthSchema>;
