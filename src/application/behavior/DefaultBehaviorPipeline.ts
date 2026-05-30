import { inject, injectable } from 'inversify';

import type { BehaviorGateDecision } from '@/domain/behavior/schemas/gate';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';

import { AI_ERROR_LOGGER_ID, type AiErrorLogger } from './AiErrorLogger';
import {
  BEHAVIOR_AI_SERVICE_ID,
  type BehaviorAiService,
} from './BehaviorAiService';
import {
  BEHAVIOR_CONTEXT_ASSEMBLER_ID,
  type BehaviorContextAssembler,
} from './BehaviorContextAssembler';
import {
  BEHAVIOR_EVENT_LOGGER_ID,
  type BehaviorEventLogger,
} from './BehaviorEventLogger';
import type { BehaviorGateBatch } from './BehaviorGateBatcher';
import { BehaviorGateBatcher } from './BehaviorGateBatcher';
import {
  BEHAVIOR_PIPELINE_CONFIG_ID,
  type BehaviorPipelineConfig,
} from './BehaviorConfig';
import type {
  BehaviorDecisionContext,
  StoredBehaviorMessage,
} from './BehaviorTypes';
import type {
  BehaviorPipeline,
  BehaviorPipelineInput,
  BehaviorPipelineResult,
} from './BehaviorPipeline';

@injectable()
export class DefaultBehaviorPipeline implements BehaviorPipeline {
  private readonly batcher: BehaviorGateBatcher;
  private readonly logger: Logger;

  constructor(
    @inject(BEHAVIOR_PIPELINE_CONFIG_ID) config: BehaviorPipelineConfig,
    @inject(BEHAVIOR_AI_SERVICE_ID) private readonly ai: BehaviorAiService,
    @inject(BEHAVIOR_CONTEXT_ASSEMBLER_ID)
    private readonly assembler: BehaviorContextAssembler,
    @inject(BEHAVIOR_EVENT_LOGGER_ID)
    private readonly eventLogger: BehaviorEventLogger,
    @inject(AI_ERROR_LOGGER_ID) private readonly errorLogger: AiErrorLogger,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('DefaultBehaviorPipeline');
    this.batcher = new BehaviorGateBatcher(
      config,
      (batch) => void this.processTimerBatch(batch),
      loggerFactory
    );
  }

  async handleStoredMessage(
    input: BehaviorPipelineInput
  ): Promise<BehaviorPipelineResult> {
    const { message, directTrigger } = input;

    if (directTrigger) {
      return this.processDirectTrigger(message, directTrigger);
    }

    const batch = this.batcher.add(message);
    if (!batch) {
      return { kind: 'queued' };
    }

    return this.processBatch(batch);
  }

  private async processTimerBatch(batch: BehaviorGateBatch): Promise<void> {
    try {
      await this.processBatch(batch);
    } catch (error) {
      this.logger.error(
        { error, chatId: batch.chatId },
        'Timer-driven batch processing failed'
      );
    }
  }

  private async processBatch(
    batch: BehaviorGateBatch
  ): Promise<BehaviorPipelineResult> {
    let gateResult;
    try {
      gateResult = await this.ai.evaluateGate(batch.messages);
    } catch (error) {
      const errorEventId = await this.errorLogger.log({
        chatId: batch.chatId,
        source: 'behavior_gate_openai',
        severity: 'error',
        errorCode: 'GATE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        component: 'DefaultBehaviorPipeline',
        operation: 'evaluateGate',
        inputRef: { chatId: batch.chatId, messageCount: batch.messages.length },
        fixHint: 'Check OpenAI API connectivity and gate schema',
      });
      return { kind: 'error', errorEventId };
    }

    const { decision: gate } = gateResult;

    if (!gate.shouldDecide) {
      return { kind: 'ignored', gate };
    }

    return this.decide(
      batch.chatId,
      gate,
      batch.messages.map((message) => message.id)
    );
  }

  private async processDirectTrigger(
    message: StoredBehaviorMessage,
    directTrigger: NonNullable<BehaviorPipelineInput['directTrigger']>
  ): Promise<BehaviorPipelineResult> {
    const { chatId } = message;
    const drained = this.batcher.drainForDirectTrigger(chatId);

    const gate: BehaviorGateDecision = {
      shouldDecide: true,
      confidence: 1,
      reason: 'direct_trigger',
      triggerMessageIds: [directTrigger.triggerMessageId],
      contextMessageIds: drained.map((m) => m.id),
      stateImpactRisk: 'medium',
    };

    return this.decide(
      chatId,
      gate,
      drained.map((m) => m.id)
    );
  }

  private async decide(
    chatId: number,
    gate: BehaviorGateDecision,
    batchMessageIds: number[]
  ): Promise<BehaviorPipelineResult> {
    let context: BehaviorDecisionContext;
    try {
      context = await this.assembler.assemble({
        chatId,
        triggerMessageIds: gate.triggerMessageIds,
        contextMessageIds: gate.contextMessageIds,
        batchMessageIds,
        gate,
      });
    } catch (error) {
      const errorEventId = await this.errorLogger.log({
        chatId,
        source: 'behavior_decision_openai',
        severity: 'error',
        errorCode: 'CONTEXT_ASSEMBLY_FAILED',
        message: error instanceof Error ? error.message : String(error),
        component: 'DefaultBehaviorPipeline',
        operation: 'assemble',
        inputRef: {
          triggerMessageIds: gate.triggerMessageIds,
          contextMessageIds: gate.contextMessageIds,
          batchMessageIds,
        },
        fixHint: 'Check context assembler and repositories',
      });
      return { kind: 'error', errorEventId };
    }

    let decisionResult;
    try {
      decisionResult = await this.ai.decideBehavior(context);
    } catch (error) {
      const errorEventId = await this.errorLogger.log({
        chatId,
        source: 'behavior_decision_openai',
        severity: 'error',
        errorCode: 'DECISION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        component: 'DefaultBehaviorPipeline',
        operation: 'decideBehavior',
        inputRef: {
          triggerMessageIds: gate.triggerMessageIds,
          contextMessageIds: gate.contextMessageIds,
          batchMessageIds,
        },
        fixHint: 'Check OpenAI API connectivity and decision schema',
      });
      return { kind: 'error', errorEventId };
    }

    const behaviorEventId = await this.eventLogger.logDecision({
      context,
      result: decisionResult,
    });

    return {
      kind: 'decided',
      context,
      decision: decisionResult.decision,
      behaviorEventId,
    };
  }
}
