import { z } from 'zod';

import type { Env } from '@/application/interfaces/env/EnvService';

export const envSchema = z
  .object({
    BOT_TOKEN: z.string().min(1),
    OPENAI_KEY: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    LOG_LEVEL: z.string().default('debug'),
    ADMIN_CHAT_ID: z.coerce.number(),
    NODE_ENV: z.string().default('development'),
    LOG_PROMPTS: z.coerce.boolean().default(false),
    VOICE_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
    VOICE_WORKER_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(1000),
    VOICE_WORKER_LOCK_MS: z.coerce.number().int().positive().default(300000),
    VOICE_WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    VOICE_TRANSCRIPTION_MODEL: z
      .string()
      .min(1)
      .default('gpt-4o-mini-transcribe'),
    VOICE_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(120),
    VOICE_TRANSCRIPTION_WAIT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120000),
    VOICE_TRANSCRIPTION_RESULT_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(500),
  })
  .transform((env) => ({
    ...env,
    LOG_PROMPTS: env.NODE_ENV === 'development',
  })) as z.ZodType<Env>;
