import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TestEnvService } from '../src/infrastructure/config/TestEnvService';

const OLD_ENV = { ...process.env };

const setRequiredEnv = (
  overrides: Record<string, string | undefined> = {}
): void => {
  process.env.BOT_TOKEN = 'token';
  process.env.OPENAI_KEY = 'key';
  process.env.DATABASE_URL = 'file:///tmp/test.db';
  process.env.ADMIN_CHAT_ID = '1';
  Object.entries(overrides).forEach(([k, v]) => {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  });
};

describe('EnvService', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('parses environment variables and applies defaults', () => {
    setRequiredEnv({ LOG_LEVEL: undefined, LOG_PROMPTS: undefined });

    const env = new TestEnvService();

    expect(env.env.BOT_TOKEN).toBe('token');
    expect(env.env.LOG_LEVEL).toBe('silent');
    expect(env.env.LOG_PROMPTS).toBe(false);
  });

  it('getModels returns correct models', () => {
    setRequiredEnv();
    const env = new TestEnvService();
    expect(env.getModels()).toEqual({
      triggerGate: { default: 'gpt-5.4-mini' },
      behaviorDecision: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
      summarization: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
      stateEvolution: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
      errorRepair: { default: 'gpt-5.4-mini', escalation: 'gpt-5.5' },
    });
  });

  it('getPromptFiles returns default paths', () => {
    setRequiredEnv();
    const env = new TestEnvService();
    expect(env.getPromptFiles()).toEqual({
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
    });
  });

  it('getBotName returns the bot name', () => {
    setRequiredEnv();
    const env = new TestEnvService();
    expect(env.getBotName()).toBe('Карл');
  });

  it('getDialogueTimeoutMs returns timeout in ms', () => {
    setRequiredEnv();
    const env = new TestEnvService();
    expect(env.getDialogueTimeoutMs()).toBe(120_000);
  });

  it('getMigrationsDir returns migrations directory', () => {
    setRequiredEnv();
    const env = new TestEnvService();
    expect(env.getMigrationsDir()).toBe('migrations');
  });

  it('getVoiceConfig returns default voice configuration', () => {
    setRequiredEnv();
    const env = new TestEnvService();
    expect(env.getVoiceConfig()).toEqual({
      workerConcurrency: 1,
      workerPollIntervalMs: 1000,
      workerLockMs: 300000,
      workerMaxAttempts: 3,
      transcriptionModel: 'gpt-4o-mini-transcribe',
      maxDurationSeconds: 120,
    });
  });
});
