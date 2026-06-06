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
import {
  PROMPT_DIRECTOR_ID,
  type PromptDirector,
} from '@/application/prompts/PromptDirector';
import type { PromptMessage } from '@/application/prompts/PromptMessage';
import {
  claimExtractionResultJsonSchema,
  claimExtractionResultSchema,
  factVerificationResultJsonSchema,
  factVerificationResultSchema,
  type ClaimExtractionResult,
  type FactVerificationResult,
} from '@/domain/fact-checking/FactCheckSchemas';
import { FACT_CHECK_CONFIG_ID, type FactCheckConfig } from './FactCheckConfig';
import type {
  FactCheckExtractionPromptContext,
  FactCheckVerificationPromptContext,
} from './FactCheckPromptContext';
import type {
  FactCheckAiMetadata,
  FactCheckAiResult,
  FactCheckReasoningService,
} from './FactCheckReasoningService';

@injectable()
export class DefaultFactCheckReasoningService implements FactCheckReasoningService {
  private readonly extractionModel: AiModelId;
  private readonly verificationModel: AiModelId;
  private readonly verificationEscalationModel: AiModelId;
  private readonly logger: Logger;

  constructor(
    @inject(ENV_SERVICE_ID) private readonly envService: EnvService,
    @inject(PROMPT_DIRECTOR_ID) private readonly prompts: PromptDirector,
    @inject(AI_GATEWAY_ID) private readonly gateway: AiGateway,
    @inject(FACT_CHECK_CONFIG_ID) private readonly config: FactCheckConfig,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    const models = envService.getModels();
    this.extractionModel = models.factCheckExtraction.default;
    this.verificationModel = models.factCheckVerification.default;
    this.verificationEscalationModel = models.factCheckVerification.escalation;
    this.logger = loggerFactory.create('DefaultFactCheckReasoningService');
  }

  async extractClaims(
    input: FactCheckExtractionPromptContext
  ): Promise<FactCheckAiResult<ClaimExtractionResult>> {
    const prompt = await this.prompts.createFactCheckExtractionPrompt(input);
    const messages = this.toAiMessages(prompt);
    const start = Date.now();

    const result =
      await this.gateway.parseChatCompletion<ClaimExtractionResult>({
        model: this.extractionModel,
        messages,
        responseFormat: claimExtractionResultJsonSchema,
        parse: (content) =>
          claimExtractionResultSchema.parse(JSON.parse(content) as unknown),
      });

    const latencyMs = Date.now() - start;
    void this.logPrompt('factCheckExtraction', messages, result.raw);

    if (result.parsed == null) {
      throw new Error('Failed to parse fact-check extraction response');
    }

    return {
      result: result.parsed,
      metadata: this.buildMetadata(
        'factCheckExtraction',
        this.extractionModel,
        false,
        null,
        latencyMs,
        result.usage
      ),
      requestJson: messages,
      responseJson: result.raw,
    };
  }

  async verifyClaims(
    input: FactCheckVerificationPromptContext
  ): Promise<FactCheckAiResult<FactVerificationResult>> {
    const prompt = await this.prompts.createFactCheckVerificationPrompt(input);
    const messages = this.toAiMessages(prompt);

    const attempt = async (
      model: AiModelId,
      escalated: boolean,
      escalationReason: string | null
    ): Promise<FactCheckAiResult<FactVerificationResult>> => {
      const start = Date.now();
      const result =
        await this.gateway.parseChatCompletion<FactVerificationResult>({
          model,
          messages,
          responseFormat: factVerificationResultJsonSchema,
          parse: (content) =>
            factVerificationResultSchema.parse(JSON.parse(content) as unknown),
        });
      const latencyMs = Date.now() - start;
      void this.logPrompt('factCheckVerification', messages, result.raw);

      const threshold = this.config.verificationConfidenceThreshold;
      const canEscalate = model !== this.verificationEscalationModel;

      if (result.parsed == null) {
        if (canEscalate) {
          return attempt(
            this.verificationEscalationModel,
            true,
            'schema_validation_failed'
          );
        }
        throw new Error('Failed to parse fact-check verification response');
      }

      const lowConfidence = result.parsed.findings.some(
        (f) => f.status !== 'no_error' && f.confidence < threshold
      );
      if (lowConfidence && canEscalate) {
        return attempt(
          this.verificationEscalationModel,
          true,
          'low_confidence'
        );
      }

      return {
        result: result.parsed,
        metadata: this.buildMetadata(
          'factCheckVerification',
          model,
          escalated,
          escalationReason,
          latencyMs,
          result.usage
        ),
        requestJson: messages,
        responseJson: result.raw,
      };
    };

    return attempt(this.verificationModel, false, null);
  }

  private buildMetadata(
    modelSlot: string,
    selectedModel: AiModelId,
    escalated: boolean,
    escalationReason: string | null,
    latencyMs: number,
    usage: AiUsage
  ): FactCheckAiMetadata {
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
