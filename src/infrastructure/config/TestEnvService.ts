import { injectable } from 'inversify';

import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import type { FactCheckConfig } from '@/application/fact-checking/FactCheckConfig';
import type {
  AiModelSlots,
  Env,
  EnvService,
  PromptFiles,
} from '@/application/interfaces/env/EnvService';
import type { VoiceConfig } from '@/application/voice/VoiceConfig';

import { envSchema } from './envSchema';

@injectable()
export class TestEnvService implements EnvService {
  public readonly env: Env;

  constructor() {
    this.env = envSchema.parse({
      BOT_TOKEN: process.env.BOT_TOKEN ?? 'test',
      BOT_NAME: process.env.BOT_NAME ?? 'Bot',
      OPENAI_KEY: process.env.OPENAI_KEY ?? 'test',
      DATABASE_URL: process.env.DATABASE_URL ?? 'file:///tmp/test.db',
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
      ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID ?? '0',
      NODE_ENV: 'test',
      LOG_PROMPTS: process.env.LOG_PROMPTS ?? false,
    });
  }

  getModels(): AiModelSlots {
    return {
      triggerGate: { default: 'gpt-5.4-mini' as AiModelId },
      behaviorDecision: {
        default: 'gpt-5.4-mini' as AiModelId,
        escalation: 'gpt-5.5' as AiModelId,
      },
      summarization: {
        default: 'gpt-5.4-mini' as AiModelId,
        escalation: 'gpt-5.5' as AiModelId,
      },
      stateEvolution: {
        default: 'gpt-5.4-mini' as AiModelId,
        escalation: 'gpt-5.5' as AiModelId,
      },
      errorRepair: {
        default: 'gpt-5.4-mini' as AiModelId,
        escalation: 'gpt-5.5' as AiModelId,
      },
      factCheckExtraction: { default: 'gpt-5.4-mini' as AiModelId },
      factCheckVerification: {
        default: 'gpt-5.4-mini' as AiModelId,
        escalation: 'gpt-5.5' as AiModelId,
      },
      sourceSearch: { default: 'gpt-5.4-mini' as AiModelId },
    };
  }

  getPromptFiles(): PromptFiles {
    return {
      askSummary: 'prompts/ask_summary_prompt.md',
      summarizationSystem: 'prompts/summarization_system_prompt.md',
      previousSummary: 'prompts/previous_summary_prompt.md',
      userPrompt: 'prompts/user_prompt.md',
      userPromptSystem: 'prompts/user_prompt_system_prompt.md',
      chatUser: 'prompts/chat_user_prompt.md',
      priorityRulesSystem: 'prompts/priority_rules_system_prompt.md',
      topicOfDaySystem: 'prompts/topic_of_day_system_prompt.md',
      neutralCore: 'prompts/neutral_core_prompt.md',
      behaviorGateSystem: 'prompts/behavior_gate_system_prompt.md',
      behaviorDecisionSystem: 'prompts/behavior_decision_system_prompt.md',
      personalityState: 'prompts/personality_state_prompt.md',
      politicalState: 'prompts/political_state_prompt.md',
      userProfiles: 'prompts/user_profiles_prompt.md',
      truths: 'prompts/truths_prompt.md',
      behaviorMessages: 'prompts/behavior_messages_prompt.md',
      stateEvolutionSystem: 'prompts/state_evolution_system_prompt.md',
      personalitySignals: 'prompts/personality_signals_prompt.md',
      userPoliticalProfiles: 'prompts/user_political_profiles_prompt.md',
      factCheckClaimExtractionSystem:
        'prompts/fact_check_claim_extraction_system_prompt.md',
      factCheckVerificationSystem:
        'prompts/fact_check_verification_system_prompt.md',
    };
  }

  getBotName(): string {
    return this.env.BOT_NAME;
  }

  getDialogueTimeoutMs(): number {
    return 2 * 60 * 1000;
  }

  getMigrationsDir(): string {
    return 'migrations';
  }

  getVoiceConfig(): VoiceConfig {
    return {
      workerConcurrency: this.env.VOICE_WORKER_CONCURRENCY,
      workerPollIntervalMs: this.env.VOICE_WORKER_POLL_INTERVAL_MS,
      workerLockMs: this.env.VOICE_WORKER_LOCK_MS,
      workerMaxAttempts: this.env.VOICE_WORKER_MAX_ATTEMPTS,
      transcriptionModel: this.env.VOICE_TRANSCRIPTION_MODEL,
      maxDurationSeconds: this.env.VOICE_MAX_DURATION_SECONDS,
      transcriptionWaitTimeoutMs: this.env.VOICE_TRANSCRIPTION_WAIT_TIMEOUT_MS,
      transcriptionResultPollIntervalMs:
        this.env.VOICE_TRANSCRIPTION_RESULT_POLL_INTERVAL_MS,
    };
  }

  getFactCheckConfig(): FactCheckConfig {
    return {
      enabled: this.env.FACT_CHECK_ENABLED,
      hourlyCron: this.env.FACT_CHECK_HOURLY_CRON,
      dailyStatsCron: this.env.FACT_CHECK_DAILY_STATS_CRON,
      weeklyStatsCron: this.env.FACT_CHECK_WEEKLY_STATS_CRON,
      monthlyStatsCron: this.env.FACT_CHECK_MONTHLY_STATS_CRON,
      timezone: this.env.FACT_CHECK_TIMEZONE,
      maxMessagesPerBatch: this.env.FACT_CHECK_MAX_MESSAGES_PER_BATCH,
      maxClaimsPerBatch: this.env.FACT_CHECK_MAX_CLAIMS_PER_BATCH,
      maxHistoryContextMessages:
        this.env.FACT_CHECK_MAX_HISTORY_CONTEXT_MESSAGES,
      maxSourceSearchesPerBatch:
        this.env.FACT_CHECK_MAX_SOURCE_SEARCHES_PER_BATCH,
      maxSourcesPerFinding: this.env.FACT_CHECK_MAX_SOURCES_PER_FINDING,
      maxDisplayedSourcesPerFinding:
        this.env.FACT_CHECK_MAX_DISPLAYED_SOURCES_PER_FINDING,
      maxFindingsPerDigestMessage:
        this.env.FACT_CHECK_MAX_FINDINGS_PER_DIGEST_MESSAGE,
      verificationConfidenceThreshold:
        this.env.FACT_CHECK_VERIFICATION_CONFIDENCE_THRESHOLD,
    };
  }
}
