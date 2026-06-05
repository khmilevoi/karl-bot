import { promises as fs } from 'fs';
import { inject, injectable } from 'inversify';
import path from 'path';

import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import {
  AI_GATEWAY_ID,
  type AiGateway,
  type AiMessage,
  type AiUsage,
} from '@/application/interfaces/ai/AiGateway';
import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type { BehaviorAiService } from '@/application/behavior/BehaviorAiService';
import {
  BEHAVIOR_PIPELINE_CONFIG_ID,
  type BehaviorPipelineConfig,
} from '@/application/behavior/BehaviorConfig';
import type {
  AiCallMetadata,
  BehaviorAiDecisionResult,
  BehaviorDecisionContext,
  GateAiResult,
  StateEvolutionContext,
  StateEvolutionResult,
  StoredBehaviorMessage,
} from '@/application/behavior/BehaviorTypes';
import {
  translateEvolutionPatches,
  translateGateDecision,
  translateLivePatches,
  translateTruthPatches,
} from '@/application/behavior/OrdinalTranslation';
import { MessageReferenceMap } from '@/application/prompts/MessageReferenceMap';
import {
  PROMPT_DIRECTOR_ID,
  type PromptDirector,
} from '@/application/prompts/PromptDirector';
import type { PromptMessage } from '@/application/prompts/PromptMessage';
import {
  behaviorDecisionJsonSchema,
  behaviorDecisionSchema,
  type BehaviorDecision,
} from '@/domain/behavior/schemas/decision';
import {
  stateEvolutionDecisionSchema,
  stateEvolutionJsonSchema,
  type StateEvolutionDecision,
} from '@/domain/behavior/schemas/evolution';
import {
  behaviorGateDecisionSchema,
  behaviorGateJsonSchema,
  type BehaviorGateDecision,
} from '@/domain/behavior/schemas/gate';
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
export class CarlBehaviorModelService implements BehaviorAiService {
  private readonly triggerGateModel: AiModelId;
  private readonly behaviorDecisionModel: AiModelId;
  private readonly behaviorDecisionEscalationModel: AiModelId;
  private readonly stateEvolutionModel: AiModelId;
  private readonly stateEvolutionEscalationModel: AiModelId;
  private readonly logger: Logger;

  constructor(
    @inject(ENV_SERVICE_ID) private readonly envService: EnvService,
    @inject(PROMPT_DIRECTOR_ID) private readonly prompts: PromptDirector,
    @inject(BEHAVIOR_PIPELINE_CONFIG_ID)
    private readonly behaviorConfig: BehaviorPipelineConfig,
    @inject(AI_GATEWAY_ID) private readonly gateway: AiGateway,
    @inject(LOGGER_FACTORY_ID) private readonly loggerFactory: LoggerFactory
  ) {
    const models = this.envService.getModels();
    this.triggerGateModel = models.triggerGate.default;
    this.behaviorDecisionModel = models.behaviorDecision.default;
    this.behaviorDecisionEscalationModel = models.behaviorDecision.escalation;
    this.stateEvolutionModel = models.stateEvolution.default;
    this.stateEvolutionEscalationModel = models.stateEvolution.escalation;
    this.logger = this.loggerFactory.create('CarlBehaviorModelService');
  }

  public async evaluateGate(
    messages: StoredBehaviorMessage[]
  ): Promise<GateAiResult> {
    const refMap = MessageReferenceMap.fromMessages(messages);
    const prompt = await this.prompts.createBehaviorGatePrompt(
      messages,
      refMap
    );
    const aiMessages = this.toAiMessages(prompt);
    const start = Date.now();

    const result = await this.gateway.parseChatCompletion<BehaviorGateDecision>(
      {
        model: this.triggerGateModel,
        messages: aiMessages,
        responseFormat: behaviorGateJsonSchema,
        parse: (content) => {
          const parsed: unknown = JSON.parse(content);
          return behaviorGateDecisionSchema.parse(parsed);
        },
      }
    );

    const latencyMs = Date.now() - start;
    const raw = result.parsed;
    void this.logPrompt('behaviorGate', aiMessages, raw);

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
      decision: translateGateDecision(parsed.data, refMap),
      metadata: this.buildMetadata(
        'triggerGate',
        this.triggerGateModel,
        false,
        null,
        latencyMs,
        result.usage
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

    const refMap = MessageReferenceMap.fromMessages(context.messages);
    const prompt = await this.prompts.createBehaviorDecisionPrompt(
      context,
      refMap
    );
    const aiMessages = this.toAiMessages(prompt);

    const attempt = async (
      model: AiModelId,
      escalationReason: BehaviorEscalationReason | null
    ): Promise<BehaviorAiDecisionResult> => {
      const start = Date.now();
      const result = await this.gateway.parseChatCompletion<BehaviorDecision>({
        model,
        messages: aiMessages,
        responseFormat: behaviorDecisionJsonSchema,
        parse: (content) => {
          const parsed: unknown = JSON.parse(content);
          return behaviorDecisionSchema.parse(parsed);
        },
      });
      const latencyMs = Date.now() - start;
      const raw = result.parsed;
      const logType =
        escalationReason != null
          ? 'behaviorDecisionEscalated'
          : 'behaviorDecision';
      void this.logPrompt(logType, aiMessages, raw);

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

      const decision = {
        ...parsed.data,
        statePatches: translateLivePatches(parsed.data.statePatches, refMap),
      };
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
          result.usage
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

    const refMap = MessageReferenceMap.fromMessages(context.messages);
    const prompt = await this.prompts.createStateEvolutionPrompt(
      context,
      refMap
    );
    const aiMessages = this.toAiMessages(prompt);

    const attempt = async (
      model: AiModelId,
      escalationReason: EvolutionEscalationReason | null
    ): Promise<StateEvolutionResult> => {
      const start = Date.now();
      const result =
        await this.gateway.parseChatCompletion<StateEvolutionDecision>({
          model,
          messages: aiMessages,
          responseFormat: stateEvolutionJsonSchema,
          parse: (content) => {
            const parsed: unknown = JSON.parse(content);
            return stateEvolutionDecisionSchema.parse(parsed);
          },
        });
      const latencyMs = Date.now() - start;
      const raw = result.parsed;
      void this.logPrompt('stateEvolution', aiMessages, raw);

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

      const decision = {
        ...parsed.data,
        evolutionPatches: translateEvolutionPatches(
          parsed.data.evolutionPatches,
          refMap
        ),
        truthPatches: translateTruthPatches(parsed.data.truthPatches, refMap),
      };

      if (
        model !== this.stateEvolutionEscalationModel &&
        this.hasRadicalPatch(decision.evolutionPatches)
      ) {
        return attempt(this.stateEvolutionEscalationModel, 'radical_review');
      }

      return {
        decision,
        metadata: this.buildMetadata(
          'stateEvolution',
          model,
          escalationReason != null,
          escalationReason,
          latencyMs,
          result.usage
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
    selectedModel: AiModelId,
    escalated: boolean,
    escalationReason: string | null,
    latencyMs: number,
    usage: AiUsage
  ): AiCallMetadata {
    return {
      modelSlot,
      selectedModel,
      escalated,
      escalationReason,
      latencyMs,
      usage,
    };
  }

  private async logPrompt(
    type: string,
    messages: AiMessage[],
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

  private toAiMessages(messages: PromptMessage[]): AiMessage[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }
}
