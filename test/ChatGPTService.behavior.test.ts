import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatGPTService as ChatGPTServiceType } from '../src/infrastructure/external/ChatGPTService';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { DEFAULT_BEHAVIOR_PIPELINE_CONFIG } from '../src/application/behavior/BehaviorConfig';
import type { PromptDirector } from '../src/application/prompts/PromptDirector';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { BehaviorDecisionContext } from '../src/application/behavior/BehaviorTypes';
import {
  behaviorDecisionJsonSchema,
  type BehaviorGateDecision,
  behaviorGateJsonSchema,
} from '../src/domain/behavior/schemas';

interface ChatGPTServiceConstructor {
  new (
    env: TestEnvService,
    prompts: PromptDirector,
    behaviorConfig: typeof DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
    logger: LoggerFactory
  ): ChatGPTServiceType;
}

interface OpenAiParseCall {
  response_format?: {
    json_schema?: unknown;
  };
}

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

describe('ChatGPTService behavior methods', () => {
  let ChatGPTService: ChatGPTServiceConstructor;
  let service: ChatGPTServiceType;
  let openaiCreate: ReturnType<typeof vi.fn>;
  let openaiParse: ReturnType<typeof vi.fn>;
  let prompts: Record<string, unknown>;
  let env: TestEnvService;
  let loggerFactory: LoggerFactory;

  beforeEach(async () => {
    vi.resetModules();

    openaiCreate = vi.fn();
    openaiParse = vi.fn();
    const openaiMock = {
      chat: { completions: { create: openaiCreate, parse: openaiParse } },
    };
    vi.doMock('openai', () => ({ default: vi.fn(() => openaiMock) }));

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

    ({ ChatGPTService } =
      await import('../src/infrastructure/external/ChatGPTService'));
    service = new ChatGPTService(
      env,
      prompts as unknown as PromptDirector,
      DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
      loggerFactory
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evaluateGate uses triggerGate.default model and json_schema response format', async () => {
    openaiParse.mockResolvedValue({
      choices: [{ message: { parsed: validGateResponse } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await service.evaluateGate([]);

    expect(openaiParse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().triggerGate.default,
        response_format: expect.objectContaining({ type: 'json_schema' }),
      })
    );
    expect(result.decision.shouldDecide).toBe(true);
    expect(result.metadata.escalated).toBe(false);
    expect(result.metadata.usage.promptTokens).toBe(10);
  });

  it('evaluateGate sends the strict-compatible BehaviorGate schema', async () => {
    openaiParse.mockResolvedValue({
      choices: [{ message: { parsed: validGateResponse } }],
      usage: {},
    });

    await service.evaluateGate([]);

    const call = openaiParse.mock.calls[0]?.[0] as OpenAiParseCall;
    expect(call.response_format?.json_schema).toEqual(behaviorGateJsonSchema);
    expect(JSON.stringify(call.response_format)).not.toContain('"maximum"');
  });

  it('decideBehavior starts on default model for medium risk', async () => {
    openaiParse.mockResolvedValue({
      choices: [{ message: { parsed: validDecision } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await service.decideBehavior(makeContext('medium'));

    expect(openaiParse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().behaviorDecision.default,
      })
    );
    expect(result.decision.confidence).toBe(0.8);
    expect(result.metadata.escalated).toBe(false);
  });

  it('decideBehavior sends the strict-compatible BehaviorDecision schema', async () => {
    openaiParse.mockResolvedValue({
      choices: [{ message: { parsed: validDecision } }],
      usage: {},
    });

    await service.decideBehavior(makeContext('medium'));

    const call = openaiParse.mock.calls[0]?.[0] as OpenAiParseCall;
    expect(call.response_format?.json_schema).toEqual(
      behaviorDecisionJsonSchema
    );
  });

  it('decideBehavior starts on escalation model when gate stateImpactRisk is high', async () => {
    openaiParse.mockResolvedValue({
      choices: [{ message: { parsed: validDecision } }],
      usage: {},
    });

    const result = await service.decideBehavior(makeContext('high'));

    expect(openaiParse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().behaviorDecision.escalation,
      })
    );
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.escalationReason).toBe('gate_state_impact_high');
  });

  it('decideBehavior escalates on invalid JSON response', async () => {
    openaiParse
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: null } }],
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: validDecision } }],
        usage: {},
      });

    const result = await service.decideBehavior(makeContext('medium'));

    expect(openaiParse).toHaveBeenCalledTimes(2);
    expect(result.metadata.escalated).toBe(true);
  });

  it('decideBehavior escalates on low confidence', async () => {
    const lowConfidenceDecision = { ...validDecision, confidence: 0.1 };
    openaiParse
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: lowConfidenceDecision } }],
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: validDecision } }],
        usage: {},
      });

    const result = await service.decideBehavior(makeContext('medium'));

    expect(openaiParse).toHaveBeenCalledTimes(2);
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.escalationReason).toBe('low_confidence');
  });

  it('decideBehavior includes latency in metadata', async () => {
    openaiParse.mockResolvedValue({
      choices: [{ message: { parsed: validDecision } }],
      usage: {},
    });

    const result = await service.decideBehavior(makeContext());

    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
