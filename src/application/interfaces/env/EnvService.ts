import type { ServiceIdentifier } from 'inversify';

import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import type { FactCheckConfig } from '@/application/fact-checking/FactCheckConfig';
import type { VoiceConfig } from '@/application/voice/VoiceConfig';

export interface Env {
  BOT_TOKEN: string;
  BOT_NAME: string;
  OPENAI_KEY: string;
  DATABASE_URL: string;
  LOG_LEVEL: string;
  ADMIN_CHAT_ID: number;
  NODE_ENV: string;
  LOG_PROMPTS: boolean;
  VOICE_WORKER_CONCURRENCY: number;
  VOICE_WORKER_POLL_INTERVAL_MS: number;
  VOICE_WORKER_LOCK_MS: number;
  VOICE_WORKER_MAX_ATTEMPTS: number;
  VOICE_TRANSCRIPTION_MODEL: string;
  VOICE_MAX_DURATION_SECONDS: number;
  VOICE_TRANSCRIPTION_WAIT_TIMEOUT_MS: number;
  VOICE_TRANSCRIPTION_RESULT_POLL_INTERVAL_MS: number;
  FACT_CHECK_ENABLED: boolean;
  FACT_CHECK_HOURLY_CRON: string;
  FACT_CHECK_DAILY_STATS_CRON: string;
  FACT_CHECK_WEEKLY_STATS_CRON: string;
  FACT_CHECK_MONTHLY_STATS_CRON: string;
  FACT_CHECK_TIMEZONE: string;
  FACT_CHECK_MAX_MESSAGES_PER_BATCH: number;
  FACT_CHECK_MAX_CLAIMS_PER_BATCH: number;
  FACT_CHECK_MAX_HISTORY_CONTEXT_MESSAGES: number;
  FACT_CHECK_MAX_SOURCE_SEARCHES_PER_BATCH: number;
  FACT_CHECK_MAX_SOURCES_PER_FINDING: number;
  FACT_CHECK_MAX_DISPLAYED_SOURCES_PER_FINDING: number;
  FACT_CHECK_MAX_FINDINGS_PER_DIGEST_MESSAGE: number;
  FACT_CHECK_VERIFICATION_CONFIDENCE_THRESHOLD: number;
}

export interface PromptFiles {
  askSummary: string;
  summarizationSystem: string;
  previousSummary: string;
  userPrompt: string;
  userPromptSystem: string;
  chatUser: string;
  priorityRulesSystem: string;
  topicOfDaySystem: string;
  neutralCore: string;
  behaviorGateSystem: string;
  behaviorDecisionSystem: string;
  personalityState: string;
  politicalState: string;
  userProfiles: string;
  truths: string;
  behaviorMessages: string;
  stateEvolutionSystem: string;
  personalitySignals: string;
  userPoliticalProfiles: string;
}

export interface SingleModelSlot {
  default: AiModelId;
}

export interface EscalatingModelSlot {
  default: AiModelId;
  escalation: AiModelId;
}

export interface AiModelSlots {
  triggerGate: SingleModelSlot;
  behaviorDecision: EscalatingModelSlot;
  summarization: EscalatingModelSlot;
  stateEvolution: EscalatingModelSlot;
  errorRepair: EscalatingModelSlot;
  factCheckExtraction: SingleModelSlot;
  factCheckVerification: EscalatingModelSlot;
  sourceSearch: SingleModelSlot;
}

export interface EnvService {
  readonly env: Env;
  getModels(): AiModelSlots;
  getPromptFiles(): PromptFiles;
  getBotName(): string;
  getDialogueTimeoutMs(): number;
  getMigrationsDir(): string;
  getVoiceConfig(): VoiceConfig;
  getFactCheckConfig(): FactCheckConfig;
}

export const ENV_SERVICE_ID = Symbol.for(
  'EnvService'
) as ServiceIdentifier<EnvService>;
