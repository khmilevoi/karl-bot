import { injectable } from 'inversify';
import type { ChatModel } from 'openai/resources/shared';

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
      triggerGate: { default: 'gpt-5.4-mini' as ChatModel },
      behaviorDecision: {
        default: 'gpt-5.4-mini' as ChatModel,
        escalation: 'gpt-5.5' as ChatModel,
      },
      summarization: {
        default: 'gpt-5.4-mini' as ChatModel,
        escalation: 'gpt-5.5' as ChatModel,
      },
      stateEvolution: {
        default: 'gpt-5.4-mini' as ChatModel,
        escalation: 'gpt-5.5' as ChatModel,
      },
      errorRepair: {
        default: 'gpt-5.4-mini' as ChatModel,
        escalation: 'gpt-5.5' as ChatModel,
      },
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
    };
  }

  getBotName(): string {
    return 'Карл';
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
    };
  }
}
