import { describe, expect, it, vi } from 'vitest';

import { DefaultBehaviorPipeline } from '../src/application/behavior/DefaultBehaviorPipeline';
import { DEFAULT_BEHAVIOR_PIPELINE_CONFIG } from '../src/application/behavior/BehaviorConfig';
import type { BehaviorAiService } from '../src/application/behavior/BehaviorAiService';
import type { BehaviorContextAssembler } from '../src/application/behavior/BehaviorContextAssembler';
import type { BehaviorEventLogger } from '../src/application/behavior/BehaviorEventLogger';
import type { AiErrorLogger } from '../src/application/behavior/AiErrorLogger';
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
    eventLogger,
    errorLogger,
    createLoggerFactory()
  );

  return { pipeline, ai, assembler, eventLogger, errorLogger };
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
