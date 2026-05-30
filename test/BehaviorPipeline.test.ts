import { describe, expect, it, vi } from 'vitest';

import { DefaultBehaviorPipeline } from '../src/application/behavior/DefaultBehaviorPipeline';
import { DEFAULT_BEHAVIOR_PIPELINE_CONFIG } from '../src/application/behavior/BehaviorConfig';
import type { BehaviorAiService } from '../src/application/behavior/BehaviorAiService';
import type { BehaviorContextAssembler } from '../src/application/behavior/BehaviorContextAssembler';
import type { BehaviorDecisionValidator } from '../src/application/behavior/BehaviorDecisionValidator';
import type { BehaviorExecutor } from '../src/application/behavior/BehaviorExecutor';
import type { BehaviorEventLogger } from '../src/application/behavior/BehaviorEventLogger';
import type { AiErrorLogger } from '../src/application/behavior/AiErrorLogger';
import type { StatePatchApplicator } from '../src/application/behavior/StatePatchApplicator';
import type {
  StoredBehaviorMessage,
  DirectBehaviorTrigger,
  BehaviorDecisionContext,
} from '../src/application/behavior/BehaviorTypes';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const config = {
  ...DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
  batchIdleGapMs: 9_999_999,
};

function createLoggerFactory(): LoggerFactory {
  return {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  } as unknown as LoggerFactory;
}

function makeMsg(id: number, chatId = 1): StoredBehaviorMessage {
  return {
    id,
    chatId,
    role: 'user',
    content: `msg ${id}`,
  } as StoredBehaviorMessage;
}

const gateFalse = {
  decision: {
    shouldDecide: false,
    confidence: 0.1,
    reason: 'not_relevant',
    triggerMessageIds: [],
    contextMessageIds: [],
    stateImpactRisk: 'none',
  },
  metadata: {
    modelSlot: 'triggerGate',
    selectedModel: 'gpt-5.4-mini' as any,
    escalated: false,
    escalationReason: null,
    latencyMs: 50,
    usage: { promptTokens: null, completionTokens: null, totalTokens: null },
  },
};

const gateTrue = {
  decision: {
    shouldDecide: true,
    confidence: 0.9,
    reason: 'conflict',
    triggerMessageIds: [1],
    contextMessageIds: [],
    stateImpactRisk: 'medium',
  },
  metadata: {
    modelSlot: 'triggerGate',
    selectedModel: 'gpt-5.4-mini' as any,
    escalated: false,
    escalationReason: null,
    latencyMs: 50,
    usage: { promptTokens: null, completionTokens: null, totalTokens: null },
  },
};

const decisionResult = {
  decision: { confidence: 0.8, actions: [], statePatches: [], safetyNotes: [] },
  metadata: {
    modelSlot: 'behaviorDecision',
    selectedModel: 'gpt-5.4-mini' as any,
    escalated: false,
    escalationReason: null,
    latencyMs: 100,
    usage: { promptTokens: null, completionTokens: null, totalTokens: null },
  },
};

const mockContext: BehaviorDecisionContext = {
  chatId: 1,
  gate: gateTrue.decision as any,
  summary: '',
  messages: [],
  triggerMessageIds: [1],
  contextMessageIds: [],
  batchMessageIds: [1, 2],
  state: {
    personality: {} as any,
    political: {} as any,
    profiles: [],
    truths: [],
  },
};

function makePipeline(overrides: {
  ai?: Partial<BehaviorAiService>;
  assembler?: Partial<BehaviorContextAssembler>;
  validator?: Partial<BehaviorDecisionValidator>;
  executor?: Partial<BehaviorExecutor>;
  applicator?: Partial<StatePatchApplicator>;
  eventLogger?: Partial<BehaviorEventLogger>;
  errorLogger?: Partial<AiErrorLogger>;
}) {
  const ai: BehaviorAiService = {
    evaluateGate: vi.fn().mockResolvedValue(gateTrue),
    decideBehavior: vi.fn().mockResolvedValue(decisionResult),
    ...overrides.ai,
  } as unknown as BehaviorAiService;

  const assembler: BehaviorContextAssembler = {
    assemble: vi.fn().mockResolvedValue(mockContext),
    ...overrides.assembler,
  } as unknown as BehaviorContextAssembler;

  const validator: BehaviorDecisionValidator = {
    validate: vi.fn().mockReturnValue({
      ok: true,
      decision: decisionResult.decision,
      droppedActions: [],
    }),
    ...overrides.validator,
  } as unknown as BehaviorDecisionValidator;

  const executor: BehaviorExecutor = {
    execute: vi.fn().mockResolvedValue([]),
    ...overrides.executor,
  } as unknown as BehaviorExecutor;

  const applicator: StatePatchApplicator = {
    applyPatches: vi.fn().mockResolvedValue([]),
    ...overrides.applicator,
  } as unknown as StatePatchApplicator;

  const eventLogger: BehaviorEventLogger = {
    logDecision: vi.fn().mockResolvedValue(99),
    ...overrides.eventLogger,
  } as unknown as BehaviorEventLogger;

  const errorLogger: AiErrorLogger = {
    log: vi.fn().mockResolvedValue(55),
    ...overrides.errorLogger,
  } as unknown as AiErrorLogger;

  const pipeline = new DefaultBehaviorPipeline(
    config,
    ai,
    assembler,
    validator,
    executor,
    applicator,
    eventLogger,
    errorLogger,
    createLoggerFactory()
  );

  return {
    pipeline,
    ai,
    assembler,
    validator,
    executor,
    applicator,
    eventLogger,
    errorLogger,
  };
}

describe('DefaultBehaviorPipeline', () => {
  it('queues non-direct message below size cap', async () => {
    const { pipeline } = makePipeline({});
    const result = await pipeline.handleStoredMessage({ message: makeMsg(1) });
    expect(result.kind).toBe('queued');
  });

  it('processes batch synchronously on size cap flush', async () => {
    const smallConfig = { ...config, batchSizeCap: 2 };
    const { pipeline, ai, eventLogger } = makePipeline({});
    // Recreate with small config
    const ai2: BehaviorAiService = {
      evaluateGate: vi.fn().mockResolvedValue(gateTrue),
      decideBehavior: vi.fn().mockResolvedValue(decisionResult),
    } as unknown as BehaviorAiService;
    const assembler2: BehaviorContextAssembler = {
      assemble: vi.fn().mockResolvedValue(mockContext),
    } as unknown as BehaviorContextAssembler;
    const eventLogger2: BehaviorEventLogger = {
      logDecision: vi.fn().mockResolvedValue(10),
    } as unknown as BehaviorEventLogger;
    const errorLogger2: AiErrorLogger = {
      log: vi.fn().mockResolvedValue(1),
    } as unknown as AiErrorLogger;
    const p2 = new DefaultBehaviorPipeline(
      smallConfig,
      ai2,
      assembler2,
      {
        validate: vi.fn().mockReturnValue({
          ok: true,
          decision: decisionResult.decision,
          droppedActions: [],
        }),
      } as unknown as BehaviorDecisionValidator,
      { execute: vi.fn().mockResolvedValue([]) } as unknown as BehaviorExecutor,
      {
        applyPatches: vi.fn().mockResolvedValue([]),
      } as unknown as StatePatchApplicator,
      eventLogger2,
      errorLogger2,
      createLoggerFactory()
    );

    await p2.handleStoredMessage({ message: makeMsg(1) });
    const result = await p2.handleStoredMessage({ message: makeMsg(2) });

    expect(result.kind).toBe('decided');
    expect(ai2.evaluateGate).toHaveBeenCalledOnce();
  });

  it('returns ignored when gate shouldDecide is false', async () => {
    const { pipeline } = makePipeline({
      ai: { evaluateGate: vi.fn().mockResolvedValue(gateFalse) },
    });
    const smallConfig = { ...config, batchSizeCap: 1 };
    const p = new DefaultBehaviorPipeline(
      smallConfig,
      {
        evaluateGate: vi.fn().mockResolvedValue(gateFalse),
        decideBehavior: vi.fn(),
      } as unknown as BehaviorAiService,
      { assemble: vi.fn() } as unknown as BehaviorContextAssembler,
      { validate: vi.fn() } as unknown as BehaviorDecisionValidator,
      { execute: vi.fn() } as unknown as BehaviorExecutor,
      { applyPatches: vi.fn() } as unknown as StatePatchApplicator,
      { logDecision: vi.fn() } as unknown as BehaviorEventLogger,
      { log: vi.fn() } as unknown as AiErrorLogger,
      createLoggerFactory()
    );

    const result = await p.handleStoredMessage({ message: makeMsg(1) });
    expect(result.kind).toBe('ignored');
  });

  it('processes direct trigger bypassing gate, draining pending batch', async () => {
    const { pipeline, ai, assembler, eventLogger } = makePipeline({});

    await pipeline.handleStoredMessage({ message: makeMsg(1) }); // queued
    const trigger: DirectBehaviorTrigger = {
      reason: 'direct_trigger',
      why: 'mentioned',
      triggerMessageId: 2,
      replyToTelegramMessageId: null,
    };
    const result = await pipeline.handleStoredMessage({
      message: makeMsg(2),
      directTrigger: trigger,
    });

    expect(ai.evaluateGate).not.toHaveBeenCalled();
    expect(assembler.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerMessageIds: [2],
        contextMessageIds: [1],
      })
    );
    expect(result.kind).toBe('decided');
    expect(eventLogger.logDecision).toHaveBeenCalledOnce();
  });

  it('validates, executes, applies patches, and logs final runtime results', async () => {
    const action = {
      type: 'reply',
      intent: 'direct_answer',
      text: 'sanitized answer',
      target: { kind: 'none' },
    } as const;
    const patch = {
      type: 'truth.add',
      text: 'new truth',
      relatedTruthIds: [],
      contradictsTruthIds: [],
      evidence: { messageIds: [1], summary: 's', confidence: 0.8 },
    } as const;
    const sanitizedDecision = {
      confidence: 0.8,
      actions: [action],
      statePatches: [patch],
      safetyNotes: [],
    };
    const actionResults = [
      { actionType: 'reply' as const, outcome: 'sent' as const, reason: null },
    ];
    const patchResults = [
      {
        patchType: 'truth.add' as const,
        outcome: 'applied' as const,
        reason: null,
      },
    ];
    const { pipeline, validator, executor, applicator, eventLogger } =
      makePipeline({
        ai: {
          decideBehavior: vi.fn().mockResolvedValue({
            decision: {
              confidence: 0.8,
              actions: [action],
              statePatches: [patch],
              safetyNotes: [],
            },
            metadata: decisionResult.metadata,
          }),
        },
        validator: {
          validate: vi.fn().mockReturnValue({
            ok: true,
            decision: sanitizedDecision,
            droppedActions: [],
          }),
        },
        executor: { execute: vi.fn().mockResolvedValue(actionResults) },
        applicator: { applyPatches: vi.fn().mockResolvedValue(patchResults) },
      });

    const result = await pipeline.handleStoredMessage({
      message: makeMsg(1),
      directTrigger: {
        reason: 'direct_trigger',
        why: 'mentioned',
        triggerMessageId: 1,
        replyToTelegramMessageId: null,
      },
    });

    expect(validator.validate).toHaveBeenCalledWith(
      expect.objectContaining({ actions: [action], statePatches: [patch] })
    );
    expect(executor.execute).toHaveBeenCalledWith({
      context: mockContext,
      actions: sanitizedDecision.actions,
    });
    expect(applicator.applyPatches).toHaveBeenCalledWith({
      chatId: 1,
      patches: sanitizedDecision.statePatches,
      contextMessages: mockContext.messages,
    });
    expect(eventLogger.logDecision).toHaveBeenCalledWith({
      context: mockContext,
      result: expect.objectContaining({ decision: sanitizedDecision }),
      actionResults,
      patchResults,
    });
    expect(result.kind).toBe('decided');
    if (result.kind === 'decided') {
      expect(result.decision).toBe(sanitizedDecision);
    }
  });

  it('logs invalid AI decisions without executing actions or patches', async () => {
    const { pipeline, executor, applicator, eventLogger, errorLogger } =
      makePipeline({
        validator: {
          validate: vi.fn().mockReturnValue({
            ok: false,
            errorCode: 'behavior_decision_validation',
            issues: ['actions.0: invalid'],
          }),
        },
      });

    const result = await pipeline.handleStoredMessage({
      message: makeMsg(1),
      directTrigger: {
        reason: 'direct_trigger',
        why: 'mentioned',
        triggerMessageId: 1,
        replyToTelegramMessageId: null,
      },
    });

    expect(result).toEqual({ kind: 'error', errorEventId: 55 });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(applicator.applyPatches).not.toHaveBeenCalled();
    expect(eventLogger.logDecision).not.toHaveBeenCalled();
    expect(errorLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'behavior_decision_validation',
        errorCode: 'DECISION_VALIDATION_FAILED',
      })
    );
  });

  it('returns error and logs AI error when gate fails', async () => {
    const smallConfig = { ...config, batchSizeCap: 1 };
    const failingAi: BehaviorAiService = {
      evaluateGate: vi.fn().mockRejectedValue(new Error('OpenAI down')),
      decideBehavior: vi.fn(),
    } as unknown as BehaviorAiService;
    const errorLogger: AiErrorLogger = {
      log: vi.fn().mockResolvedValue(55),
    } as unknown as AiErrorLogger;
    const p = new DefaultBehaviorPipeline(
      smallConfig,
      failingAi,
      { assemble: vi.fn() } as unknown as BehaviorContextAssembler,
      { validate: vi.fn() } as unknown as BehaviorDecisionValidator,
      { execute: vi.fn() } as unknown as BehaviorExecutor,
      { applyPatches: vi.fn() } as unknown as StatePatchApplicator,
      { logDecision: vi.fn() } as unknown as BehaviorEventLogger,
      errorLogger,
      createLoggerFactory()
    );

    const result = await p.handleStoredMessage({ message: makeMsg(1) });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.errorEventId).toBe(55);
    }
    expect(errorLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'behavior_gate_openai' })
    );
  });

  it('returns error and logs AI error when decide fails', async () => {
    const smallConfig = { ...config, batchSizeCap: 1 };
    const failingAi: BehaviorAiService = {
      evaluateGate: vi.fn().mockResolvedValue(gateTrue),
      decideBehavior: vi.fn().mockRejectedValue(new Error('decision failed')),
    } as unknown as BehaviorAiService;
    const errorLogger: AiErrorLogger = {
      log: vi.fn().mockResolvedValue(55),
    } as unknown as AiErrorLogger;
    const p = new DefaultBehaviorPipeline(
      smallConfig,
      failingAi,
      {
        assemble: vi.fn().mockResolvedValue(mockContext),
      } as unknown as BehaviorContextAssembler,
      { validate: vi.fn() } as unknown as BehaviorDecisionValidator,
      { execute: vi.fn() } as unknown as BehaviorExecutor,
      { applyPatches: vi.fn() } as unknown as StatePatchApplicator,
      { logDecision: vi.fn() } as unknown as BehaviorEventLogger,
      errorLogger,
      createLoggerFactory()
    );

    const result = await p.handleStoredMessage({ message: makeMsg(1) });
    expect(result.kind).toBe('error');
    expect(errorLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'behavior_decision_openai' })
    );
  });
});
