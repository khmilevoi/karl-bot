import { z } from 'zod';

import type { Env } from '@/application/interfaces/env/EnvService';

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.toLowerCase() === 'true';
}, z.boolean());

export const envSchema = z
  .object({
    BOT_TOKEN: z.string().min(1),
    BOT_NAME: z.string().min(1).default('Bot'),
    OPENAI_KEY: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    LOG_LEVEL: z.string().default('debug'),
    ADMIN_CHAT_ID: z.coerce.number(),
    NODE_ENV: z.string().default('development'),
    LOG_PROMPTS: booleanEnv.optional(),
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
    FACT_CHECK_ENABLED: booleanEnv.default(false),
    FACT_CHECK_HOURLY_CRON: z.string().min(1).default('0 0 * * * *'),
    FACT_CHECK_DAILY_STATS_CRON: z.string().min(1).default('0 0 9 * * *'),
    FACT_CHECK_WEEKLY_STATS_CRON: z.string().min(1).default('0 0 9 * * 1'),
    FACT_CHECK_MONTHLY_STATS_CRON: z.string().min(1).default('0 0 9 1 * *'),
    FACT_CHECK_TIMEZONE: z.string().min(1).default('Europe/Warsaw'),
    FACT_CHECK_MAX_MESSAGES_PER_BATCH: z.coerce
      .number()
      .int()
      .positive()
      .default(200),
    FACT_CHECK_MAX_CLAIMS_PER_BATCH: z.coerce
      .number()
      .int()
      .positive()
      .default(40),
    FACT_CHECK_MAX_HISTORY_CONTEXT_MESSAGES: z.coerce
      .number()
      .int()
      .positive()
      .default(100),
    FACT_CHECK_MAX_SOURCE_SEARCHES_PER_BATCH: z.coerce
      .number()
      .int()
      .positive()
      .default(20),
    FACT_CHECK_MAX_SOURCES_PER_FINDING: z.coerce
      .number()
      .int()
      .positive()
      .default(5),
    FACT_CHECK_MAX_DISPLAYED_SOURCES_PER_FINDING: z.coerce
      .number()
      .int()
      .positive()
      .default(3),
    FACT_CHECK_MAX_FINDINGS_PER_DIGEST_MESSAGE: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    FACT_CHECK_VERIFICATION_CONFIDENCE_THRESHOLD: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(0.75),
  })
  .transform((env) => ({
    ...env,
    LOG_PROMPTS: env.LOG_PROMPTS ?? env.NODE_ENV === 'development',
  })) as z.ZodType<Env>;
