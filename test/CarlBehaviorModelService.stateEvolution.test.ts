import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BEHAVIOR_PIPELINE_CONFIG } from '../src/application/behavior/BehaviorConfig';
import type { StateEvolutionContext } from '../src/application/behavior/BehaviorTypes';
import type { AiGateway } from '../src/application/interfaces/ai/AiGateway';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { PromptDirector } from '../src/application/prompts/PromptDirector';
import { CarlBehaviorModelService } from '../src/application/behavior/CarlBehaviorModelService';
import { stateEvolutionJsonSchema } from '../src/domain/behavior/schemas/evolution';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';

const validDecision = {
  evolutionPatches: [],
  truthPatches: [],
  personalitySnapshot: {
    identityNotes: [],
    values: [],
    speechStyle: {
      tone: 'neutral',
      humor: 'none',
      verbosity: 'short',
      formality: 'medium',
    },
    socialHabits: [],
    recurringThemes: [],
  },
  userSnapshots: [],
  botCompass: {
    economic: 0,
    social: 0,
    economicConfidence: 0,
    socialConfidence: 0,
  },
  userPoliticalSnapshots: [],
};

function makeContext(
  maxStateImpactRisk: StateEvolutionContext['maxStateImpactRisk'] = 'medium'
): StateEvolutionContext {
  return {
    chatId: 1,
    maxStateImpactRisk,
    personalitySignals: [],
    summary: '',
    messages: [],
    triggerMessageIds: [],
    contextMessageIds: [],
    batchMessageIds: [],
    state: {
      personality: {} as any,
      political: {} as any,
      profiles: [],
      truths: [],
      userPolitical: [],
    },
  };
}

describe('CarlBehaviorModelService proposeStateEvolution', () => {
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
      createStateEvolutionPrompt: vi
        .fn()
        .mockResolvedValue([{ role: 'system', content: 'evolution' }]),
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

  it('uses stateEvolution default model on non-high risk and returns not escalated', async () => {
    parseChatCompletion.mockResolvedValue({
      parsed: validDecision,
      model: env.getModels().stateEvolution.default,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      raw: {},
    });

    const result = await service.proposeStateEvolution(makeContext('low'));

    expect(parseChatCompletion).toHaveBeenCalledTimes(1);
    expect(parseChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().stateEvolution.default,
        responseFormat: stateEvolutionJsonSchema,
      })
    );
    expect(result.metadata.escalated).toBe(false);
    expect(result.metadata.modelSlot).toBe('stateEvolution');
  });

  it('starts on escalation model when maxStateImpactRisk is high', async () => {
    parseChatCompletion.mockResolvedValue({
      parsed: validDecision,
      model: env.getModels().stateEvolution.escalation,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw: {},
    });

    const result = await service.proposeStateEvolution(makeContext('high'));

    expect(parseChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().stateEvolution.escalation,
      })
    );
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.selectedModel).toBe(
      env.getModels().stateEvolution.escalation
    );
  });

  it('passes Zod parser to gateway for state evolution', async () => {
    parseChatCompletion.mockResolvedValue({
      parsed: validDecision,
      model: env.getModels().stateEvolution.default,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw: {},
    });

    await service.proposeStateEvolution(makeContext('low'));

    const call = parseChatCompletion.mock.calls[0][0] as {
      parse: (content: string) => unknown;
    };
    expect(call.parse(JSON.stringify(validDecision))).toEqual(validDecision);
  });

  it('re-runs on escalation model when proposal contains radical politics.add_position', async () => {
    const radicalDecision = {
      ...validDecision,
      evolutionPatches: [
        {
          type: 'politics.add_position',
          topic: 'state power',
          stance: 'total control',
          requestedIntensity: 'radical',
          evidence: { messageIds: [1], summary: 's', confidence: 0.9 },
        },
      ],
    };

    parseChatCompletion
      .mockResolvedValueOnce({
        parsed: radicalDecision,
        model: env.getModels().stateEvolution.default,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      })
      .mockResolvedValueOnce({
        parsed: radicalDecision,
        model: env.getModels().stateEvolution.escalation,
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        raw: {},
      });

    const result = await service.proposeStateEvolution(makeContext('low'));

    expect(parseChatCompletion).toHaveBeenCalledTimes(2);
    expect(parseChatCompletion.mock.calls[1][0].model).toBe(
      env.getModels().stateEvolution.escalation
    );
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.escalationReason).toBe('radical_review');
  });

  it('re-runs on escalation model when proposal contains politics.adjust_position radicalize', async () => {
    const radicalAdjust = {
      ...validDecision,
      evolutionPatches: [
        {
          type: 'politics.adjust_position',
          positionId: 1,
          direction: 'radicalize',
          evidence: { messageIds: [2], summary: 's', confidence: 0.8 },
        },
      ],
    };

    parseChatCompletion
      .mockResolvedValueOnce({
        parsed: radicalAdjust,
        model: env.getModels().stateEvolution.default,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      })
      .mockResolvedValueOnce({
        parsed: radicalAdjust,
        model: env.getModels().stateEvolution.escalation,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      });

    await service.proposeStateEvolution(makeContext('low'));
    expect(parseChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('re-runs on escalation model when schema parse fails on default model', async () => {
    parseChatCompletion
      .mockResolvedValueOnce({
        parsed: null,
        model: env.getModels().stateEvolution.default,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      })
      .mockResolvedValueOnce({
        parsed: validDecision,
        model: env.getModels().stateEvolution.escalation,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        raw: {},
      });

    const result = await service.proposeStateEvolution(makeContext('low'));

    expect(parseChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.escalationReason).toBe('schema_validation_failed');
  });

  it('uses OpenAI-compatible stateEvolutionJsonSchema without oneOf', async () => {
    parseChatCompletion.mockResolvedValue({
      parsed: validDecision,
      model: env.getModels().stateEvolution.default,
      usage: { promptTokens: null, completionTokens: null, totalTokens: null },
      raw: {},
    });

    await service.proposeStateEvolution(makeContext('low'));

    expect(parseChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        responseFormat: stateEvolutionJsonSchema,
      })
    );
    expect(JSON.stringify(stateEvolutionJsonSchema)).not.toContain('"oneOf"');
  });
});
