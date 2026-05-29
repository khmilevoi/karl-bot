import { z } from 'zod';

import { messageIdSchema } from './primitives';

export const replyActionSchema = z.object({
  type: z.literal('reply'),
  intent: z.enum([
    'direct_answer',
    'banter',
    'argument',
    'support',
    'correction',
  ]),
  text: z.string(),
  replyTo: z.enum(['trigger', 'latest', 'none']),
});

export const reactActionSchema = z.object({
  type: z.literal('react'),
  intent: z.enum(['approval', 'disapproval', 'mockery', 'acknowledgement']),
  emoji: z.string(),
  targetMessageId: messageIdSchema,
});

export const askQuestionActionSchema = z.object({
  type: z.literal('ask_question'),
  intent: z.enum(['clarify', 'provoke', 'invite', 'challenge']),
  text: z.string(),
  targetUsername: z.string().nullable(),
});

export const summarizeThreadActionSchema = z.object({
  type: z.literal('summarize_thread'),
  intent: z.enum(['compress_context', 'state_review']),
  reason: z.string(),
});

export const behaviorActionSchema = z.discriminatedUnion('type', [
  replyActionSchema,
  reactActionSchema,
  askQuestionActionSchema,
  summarizeThreadActionSchema,
]);

export type BehaviorAction = z.infer<typeof behaviorActionSchema>;
