import type { ServiceIdentifier } from 'inversify';
import type { ChatModel } from 'openai/resources/shared';

import type { VoiceConfig } from '@/application/voice/VoiceConfig';

export interface Env {
  BOT_TOKEN: string;
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
  default: ChatModel;
}

export interface EscalatingModelSlot {
  default: ChatModel;
  escalation: ChatModel;
}

export interface AiModelSlots {
  triggerGate: SingleModelSlot;
  behaviorDecision: EscalatingModelSlot;
  summarization: EscalatingModelSlot;
  stateEvolution: EscalatingModelSlot;
  errorRepair: EscalatingModelSlot;
}

export interface EnvService {
  readonly env: Env;
  getModels(): AiModelSlots;
  getPromptFiles(): PromptFiles;
  getBotName(): string;
  getDialogueTimeoutMs(): number;
  getMigrationsDir(): string;
  getVoiceConfig(): VoiceConfig;
}

export const ENV_SERVICE_ID = Symbol.for(
  'EnvService'
) as ServiceIdentifier<EnvService>;
