import { promises as fs } from 'fs';
import { inject, injectable } from 'inversify';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { ChatModel } from 'openai/resources/shared';
import path from 'path';

import type { AIService } from '@/application/interfaces/ai/AIService';
import type { EnvService } from '@/application/interfaces/env/EnvService';
import { ENV_SERVICE_ID } from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type { PromptDirector } from '@/application/prompts/PromptDirector';
import { PROMPT_DIRECTOR_ID } from '@/application/prompts/PromptDirector';
import type { PromptMessage } from '@/application/prompts/PromptMessage';
import type { BehaviorAiService } from '@/application/behavior/BehaviorAiService';
import {
  BEHAVIOR_PIPELINE_CONFIG_ID,
  type BehaviorPipelineConfig,
} from '@/application/behavior/BehaviorConfig';
import type {
  AiCallMetadata,
  AiCallUsage,
  BehaviorAiDecisionResult,
  BehaviorDecisionContext,
  GateAiResult,
  StateEvolutionContext,
  StateEvolutionResult,
  StoredBehaviorMessage,
} from '@/application/behavior/BehaviorTypes';
import type { ChatMessage } from '@/domain/messages/ChatMessage';
import { behaviorDecisionSchema } from '@/domain/behavior/schemas/decision';
import { stateEvolutionDecisionSchema } from '@/domain/behavior/schemas/evolution';
import { behaviorGateDecisionSchema } from '@/domain/behavior/schemas/gate';
import type { EvolutionPatch } from '@/domain/behavior/schemas/patches';

type BehaviorEscalationReason =
  | 'gate_state_impact_high'
  | 'schema_validation_failed'
  | 'low_confidence'
  | 'conflicting_visible_actions';

type EvolutionEscalationReason =
  | 'gate_state_impact_high'
  | 'schema_validation_failed'
  | 'radical_review';

@injectable()
export class ChatGPTService implements AIService, BehaviorAiService {
  private openai: OpenAI;
  private readonly triggerGateModel: ChatModel;
  private readonly behaviorDecisionModel: ChatModel;
  private readonly behaviorDecisionEscalationModel: ChatModel;
  private readonly stateEvolutionModel: ChatModel;
  private readonly stateEvolutionEscalationModel: ChatModel;
  private readonly summarizationModel: ChatModel;
  private readonly logger: Logger;

  constructor(
    @inject(ENV_SERVICE_ID) private readonly envService: EnvService,
    @inject(PROMPT_DIRECTOR_ID) private readonly prompts: PromptDirector,
    @inject(BEHAVIOR_PIPELINE_CONFIG_ID)
    private readonly behaviorConfig: BehaviorPipelineConfig,
    @inject(LOGGER_FACTORY_ID) private loggerFactory: LoggerFactory
  ) {
    const env = this.envService.env;
    this.openai = new OpenAI({ apiKey: env.OPENAI_KEY });
    const models = this.envService.getModels();
    this.triggerGateModel = models.triggerGate.default;
    this.behaviorDecisionModel = models.behaviorDecision.default;
    this.behaviorDecisionEscalationModel = models.behaviorDecision.escalation;
    this.stateEvolutionModel = models.stateEvolution.default;
    this.stateEvolutionEscalationModel = models.stateEvolution.escalation;
    this.summarizationModel = models.summarization.default;
    this.logger = this.loggerFactory.create('ChatGPTService');
    this.logger.debug('ChatGPTService initialized');
  }

  public async evaluateGate(
    messages: StoredBehaviorMessage[]
  ): Promise<GateAiResult> {
    const prompt = await this.prompts.createBehaviorGatePrompt(messages);
    const openaiMessages = this.toOpenAiMessages(prompt);
    const start = Date.now();

    const completion = await this.openai.chat.completions.parse({
      model: this.triggerGateModel,
      messages: openaiMessages,
      response_format: zodResponseFormat(
        behaviorGateDecisionSchema,
        'BehaviorGateDecision'
      ),
    });

    const latencyMs = Date.now() - start;
    const raw = completion.choices[0]?.message?.parsed;
    void this.logPrompt('behaviorGate', openaiMessages, raw);

    if (raw == null) {
      throw new Error('Failed to parse evaluateGate JSON response');
    }

    const parsed = behaviorGateDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
      );
    }

    return {
      decision: parsed.data,
      metadata: this.buildMetadata(
        'triggerGate',
        this.triggerGateModel,
        false,
        null,
        latencyMs,
        completion.usage
      ),
    };
  }

  public async decideBehavior(
    context: BehaviorDecisionContext
  ): Promise<BehaviorAiDecisionResult> {
    const preEscalate = context.gate.stateImpactRisk === 'high';
    const initialModel = preEscalate
      ? this.behaviorDecisionEscalationModel
      : this.behaviorDecisionModel;
    const preBehaviorEscalationReason: BehaviorEscalationReason | null =
      preEscalate ? 'gate_state_impact_high' : null;

    const prompt = await this.prompts.createBehaviorDecisionPrompt(context);
    const openaiMessages = this.toOpenAiMessages(prompt);

    const attempt = async (
      model: ChatModel,
      escalationReason: BehaviorEscalationReason | null
    ): Promise<BehaviorAiDecisionResult> => {
      const start = Date.now();
      const completion = await this.openai.chat.completions.parse({
        model,
        messages: openaiMessages,
        response_format: zodResponseFormat(
          behaviorDecisionSchema,
          'BehaviorDecision'
        ),
      });
      const latencyMs = Date.now() - start;
      const raw = completion.choices[0]?.message?.parsed;
      const logType =
        escalationReason != null
          ? 'behaviorDecisionEscalated'
          : 'behaviorDecision';
      void this.logPrompt(logType, openaiMessages, raw);

      if (raw == null) {
        const reason: BehaviorEscalationReason = 'schema_validation_failed';
        if (model !== this.behaviorDecisionEscalationModel) {
          return attempt(this.behaviorDecisionEscalationModel, reason);
        }
        throw new Error('Failed to parse decideBehavior JSON response');
      }

      const parsed = behaviorDecisionSchema.safeParse(raw);
      if (!parsed.success) {
        const reason: BehaviorEscalationReason = 'schema_validation_failed';
        if (model !== this.behaviorDecisionEscalationModel) {
          return attempt(this.behaviorDecisionEscalationModel, reason);
        }
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')
        );
      }

      const decision = parsed.data;
      const escalateReason = this.checkDecisionEscalation(decision.confidence);
      if (
        escalateReason != null &&
        model !== this.behaviorDecisionEscalationModel
      ) {
        return attempt(this.behaviorDecisionEscalationModel, escalateReason);
      }

      const conflicting = this.checkConflictingVisibleActions(decision.actions);
      if (conflicting && model !== this.behaviorDecisionEscalationModel) {
        return attempt(
          this.behaviorDecisionEscalationModel,
          'conflicting_visible_actions'
        );
      }

      return {
        decision,
        metadata: this.buildMetadata(
          'behaviorDecision',
          model,
          escalationReason != null,
          escalationReason,
          latencyMs,
          completion.usage
        ),
      };
    };

    return attempt(initialModel, preBehaviorEscalationReason);
  }

  public async proposeStateEvolution(
    context: StateEvolutionContext
  ): Promise<StateEvolutionResult> {
    const preEscalate = context.maxStateImpactRisk === 'high';
    const initialModel = preEscalate
      ? this.stateEvolutionEscalationModel
      : this.stateEvolutionModel;
    const preEscalationReason: EvolutionEscalationReason | null = preEscalate
      ? 'gate_state_impact_high'
      : null;

    const prompt = await this.prompts.createStateEvolutionPrompt(context);
    const openaiMessages = this.toOpenAiMessages(prompt);

    const attempt = async (
      model: ChatModel,
      escalationReason: EvolutionEscalationReason | null
    ): Promise<StateEvolutionResult> => {
      const start = Date.now();
      const completion = await this.openai.chat.completions.parse({
        model,
        messages: openaiMessages,
        response_format: zodResponseFormat(
          stateEvolutionDecisionSchema,
          'StateEvolutionDecision'
        ),
      });
      const latencyMs = Date.now() - start;
      const raw = completion.choices[0]?.message?.parsed;
      void this.logPrompt('stateEvolution', openaiMessages, raw);

      if (raw == null) {
        if (model !== this.stateEvolutionEscalationModel) {
          return attempt(
            this.stateEvolutionEscalationModel,
            'schema_validation_failed'
          );
        }
        throw new Error('Failed to parse proposeStateEvolution JSON response');
      }

      const parsed = stateEvolutionDecisionSchema.safeParse(raw);
      if (!parsed.success) {
        if (model !== this.stateEvolutionEscalationModel) {
          return attempt(
            this.stateEvolutionEscalationModel,
            'schema_validation_failed'
          );
        }
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')
        );
      }

      if (
        model !== this.stateEvolutionEscalationModel &&
        this.hasRadicalPatch(parsed.data.evolutionPatches)
      ) {
        return attempt(this.stateEvolutionEscalationModel, 'radical_review');
      }

      return {
        decision: parsed.data,
        metadata: this.buildMetadata(
          'stateEvolution',
          model,
          escalationReason != null,
          escalationReason,
          latencyMs,
          completion.usage
        ),
      };
    };

    return attempt(initialModel, preEscalationReason);
  }

  private hasRadicalPatch(patches: readonly EvolutionPatch[]): boolean {
    return patches.some(
      (p) =>
        (p.type === 'politics.add_position' &&
          p.requestedIntensity === 'radical') ||
        (p.type === 'politics.adjust_position' && p.direction === 'radicalize')
    );
  }

  private checkDecisionEscalation(
    confidence: number
  ): BehaviorEscalationReason | null {
    if (confidence < this.behaviorConfig.minDecisionConfidence) {
      return 'low_confidence';
    }
    return null;
  }

  private checkConflictingVisibleActions(actions: { type: string }[]): boolean {
    const visibleTypes = actions
      .map((a) => a.type)
      .filter((t) => t !== 'summarize_thread');
    return new Set(visibleTypes).size < visibleTypes.length;
  }

  private buildMetadata(
    modelSlot: string,
    selectedModel: ChatModel,
    escalated: boolean,
    escalationReason: string | null,
    latencyMs: number,
    usage:
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        }
      | null
      | undefined
  ): AiCallMetadata {
    const usageResult: AiCallUsage = {
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
    };
    return {
      modelSlot,
      selectedModel,
      escalated,
      escalationReason,
      latencyMs,
      usage: usageResult,
    };
  }

  public async generateTopicOfDay(params?: {
    chatTitle?: string;
    summary?: string;
    users?: { username: string; fullName: string }[];
  }): Promise<string> {
    const prompt = await this.prompts.createTopicOfDayPrompt({
      chatTitle: params?.chatTitle,
      users: params?.users,
      summary: params?.summary,
    });
    const messages = this.toOpenAiMessages(prompt);
    this.logger.debug('Sending topic of day request');
    const start = Date.now();
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.behaviorDecisionModel,
        messages,
      });
      const elapsedMs = Date.now() - start;
      this.logger.debug(
        {
          model: completion.model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
          elapsedMs,
        },
        'Received topic of day response'
      );
      const response = completion.choices[0]?.message?.content ?? '';
      void this.logPrompt('topicOfDay', messages, response);
      return response;
    } catch (err) {
      const elapsedMs = Date.now() - start;
      this.logger.error(
        {
          err,
          model: this.behaviorDecisionModel,
          messages: messages.length,
          elapsedMs,
        },
        'Topic of day request failed'
      );
      throw err;
    }
  }

  public async summarize(
    history: ChatMessage[],
    prev?: string
  ): Promise<string> {
    this.logger.debug(
      {
        history: history.length,
        prevLength: prev?.length ?? 0,
      },
      'Sending summarization request'
    );
    const prompt = await this.prompts.createSummaryPrompt(history, prev);
    const messages = this.toOpenAiMessages(prompt);
    const start = Date.now();
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.summarizationModel,
        messages,
      });
      const elapsedMs = Date.now() - start;
      this.logger.debug(
        {
          model: completion.model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
          elapsedMs,
        },
        'Received summary response'
      );
      const response = completion.choices[0]?.message?.content ?? prev ?? '';
      void this.logPrompt('summary', messages, response);
      return response;
    } catch (err) {
      const elapsedMs = Date.now() - start;
      this.logger.error(
        {
          err,
          model: this.summarizationModel,
          messages: messages.length,
          elapsedMs,
        },
        'Summarization request failed'
      );
      throw err;
    }
  }

  private async logPrompt(
    type: string,
    messages: OpenAI.ChatCompletionMessageParam[],
    response?: unknown
  ): Promise<void> {
    if (!this.envService.env.LOG_PROMPTS) {
      return;
    }
    const filePath = path.join(process.cwd(), 'prompts.log');
    const responseText =
      typeof response === 'string'
        ? response
        : JSON.stringify(response, null, 2);
    const entry = `\n[${new Date().toISOString()}] ${type}\nPROMPT:\n${JSON.stringify(
      messages,
      null,
      2
    )}\n${response != null ? `RESPONSE:\n${responseText}\n` : ''}---\n`;
    try {
      await fs.appendFile(filePath, entry);
    } catch (err) {
      this.logger.error({ err }, 'Failed to write prompt log');
    }
  }

  private toOpenAiMessages(
    messages: PromptMessage[]
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }
}
