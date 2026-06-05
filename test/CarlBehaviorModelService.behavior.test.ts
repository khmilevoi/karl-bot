import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
  type BehaviorPipelineConfig,
} from '../src/application/behavior/BehaviorConfig';
import type { BehaviorDecisionContext } from '../src/application/behavior/BehaviorTypes';
import type { AiGateway } from '../src/application/interfaces/ai/AiGateway';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { PromptDirector } from '../src/application/prompts/PromptDirector';
import { CarlBehaviorModelService } from '../src/application/behavior/CarlBehaviorModelService';
import {
  behaviorDecisionJsonSchema,
  type BehaviorGateDecision,
  behaviorGateJsonSchema,
} from '../src/domain/behavior/schemas';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';

const validGateResponse: BehaviorGateDecision = {
  shouldDecide: true,
  confidence: 0.9,
  reason: 'conflict',
  triggerMessageIds: [1],
  contextMessageIds: [],
  stateImpactRisk: 'medium',
};

const validDecision = {
  confidence: 0.8,
  actions: [],
  statePatches: [],
  safetyNotes: [],
};

function makeContext(
  stateImpactRisk: BehaviorGateDecision['stateImpactRisk'] = 'medium'
): BehaviorDecisionContext {
  return {
    chatId: 1,
    gate: {
      shouldDecide: true,
      confidence: 0.9,
      reason: 'conflict',
      triggerMessageIds: [1],
      contextMessageIds: [],
      stateImpactRisk,
    },
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
}

describe('CarlBehaviorModelService behavior methods', () => {
  let service: CarlBehaviorModelService;
  let parseChatCompletion: ReturnType<typeof vi.fn>;
  let prompts: Record<string, unknown>;
  let env: TestEnvService;
  let gateway: AiGateway;
  let loggerFactory: LoggerFactory;

  beforeEach(() => {
    parseChatCompletion = vi.fn();
    gateway = {
      parseChatCompletion,
    } as unknown as AiGateway;

    prompts = {
      createBehaviorGatePrompt: vi
        .fn()
        .mockResolvedValue([{ role: 'system', content: 'gate' }]),
      createBehaviorDecisionPrompt: vi
        .fn()
        .mockResolvedValue([{ role: 'system', content: 'decision' }]),
    };

    env = new TestEnvService();
    loggerFactory = {
      create: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    } as unknown as LoggerFactory;

    service = new CarlBehaviorModelService(
      env,
      prompts as unknown as PromptDirector,
      DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
      gateway,
      loggerFactory
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evaluateGate uses triggerGate.default model and json_schema response format', async () => {
    parseChatCompletion.mockResolvedValue({
      parsed: validGateResponse,
      model: env.getModels().triggerGate.default,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      raw: {},
    });

    const result = await service.evaluateGate([]);

    expect(parseChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().triggerGate.default,
        responseFormat: behaviorGateJsonSchema,
      })
    );
    expect(result.decision.shouldDecide).toBe(true);
    expect(result.metadata.escalated).toBe(false);
    expect(result.metadata.usage.promptTokens).toBe(10);
  });

  it('decideBehavior starts on default model for medium risk', async () => {
    parseChatCompletion.mockResolvedValue({
      parsed: validDecision,
      model: env.getModels().behaviorDecision.default,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      raw: {},
    });

    const result = await service.decideBehavior(makeContext('medium'));

    expect(parseChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().behaviorDecision.default,
        responseFormat: behaviorDecisionJsonSchema,
      })
    );
    expect(result.decision.confidence).toBe(0.8);
    expect(result.metadata.escalated).toBe(false);
  });

  it('passes Zod parser to gateway for behavior decisions', async () => {
    parseChatCompletion.mockResolvedValue({
      parsed: validDecision,
      model: env.getModels().behaviorDecision.default,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw: {},
    });

    await service.decideBehavior(makeContext('medium'));

    const call = parseChatCompletion.mock.calls[0][0] as {
      parse: (content: string) => unknown;
    };
    expect(call.parse(JSON.stringify(validDecision))).toEqual(validDecision);
  });

  it('decideBehavior starts on escalation model when gate stateImpactRisk is high', async () => {
    parseChatCompletion.mockResolvedValue({
      parsed: validDecision,
      model: env.getModels().behaviorDecision.escalation,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw: {},
    });

    const result = await service.decideBehavior(makeContext('high'));

    expect(parseChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().behaviorDecision.escalation,
      })
    );
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.escalationReason).toBe('gate_state_impact_high');
  });

  it('decideBehavior escalates on invalid JSON response', async () => {
    parseChatCompletion
      .mockResolvedValueOnce({
        parsed: null,
        model: env.getModels().behaviorDecision.default,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      })
      .mockResolvedValueOnce({
        parsed: validDecision,
        model: env.getModels().behaviorDecision.escalation,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      });

    const result = await service.decideBehavior(makeContext('medium'));

    expect(parseChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.metadata.escalated).toBe(true);
  });

  it('decideBehavior escalates on low confidence', async () => {
    const lowConfidenceDecision = { ...validDecision, confidence: 0.1 };
    parseChatCompletion
      .mockResolvedValueOnce({
        parsed: lowConfidenceDecision,
        model: env.getModels().behaviorDecision.default,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      })
      .mockResolvedValueOnce({
        parsed: validDecision,
        model: env.getModels().behaviorDecision.escalation,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      });

    const result = await service.decideBehavior(makeContext('medium'));

    expect(parseChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.escalationReason).toBe('low_confidence');
  });

  it('decideBehavior escalates on conflicting visible actions', async () => {
    const conflictingDecision = {
      ...validDecision,
      actions: [
        {
          type: 'reply',
          intent: 'banter',
          text: 'a',
          target: { kind: 'none' },
        },
        {
          type: 'reply',
          intent: 'argument',
          text: 'b',
          target: { kind: 'none' },
        },
      ],
    };
    parseChatCompletion
      .mockResolvedValueOnce({
        parsed: conflictingDecision,
        model: env.getModels().behaviorDecision.default,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      })
      .mockResolvedValueOnce({
        parsed: validDecision,
        model: env.getModels().behaviorDecision.escalation,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      });

    const result = await service.decideBehavior(makeContext('medium'));

    expect(parseChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.escalationReason).toBe(
      'conflicting_visible_actions'
    );
  });

  it('decideBehavior includes latency in metadata', async () => {
    parseChatCompletion.mockResolvedValue({
      parsed: validDecision,
      model: env.getModels().behaviorDecision.default,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw: {},
    });

    const result = await service.decideBehavior(makeContext());

    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('accepts custom behavior pipeline config for low confidence escalation', async () => {
    const config: BehaviorPipelineConfig = {
      ...DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
      minDecisionConfidence: 0.95,
    };
    service = new CarlBehaviorModelService(
      env,
      prompts as unknown as PromptDirector,
      config,
      gateway,
      loggerFactory
    );
    parseChatCompletion
      .mockResolvedValueOnce({
        parsed: validDecision,
        model: env.getModels().behaviorDecision.default,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      })
      .mockResolvedValueOnce({
        parsed: validDecision,
        model: env.getModels().behaviorDecision.escalation,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      });

    await service.decideBehavior(makeContext('medium'));

    expect(parseChatCompletion).toHaveBeenCalledTimes(2);
  });
});
