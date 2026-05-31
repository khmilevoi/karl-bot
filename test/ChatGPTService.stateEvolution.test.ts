import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatGPTService as ChatGPTServiceType } from '../src/infrastructure/external/ChatGPTService';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { DEFAULT_BEHAVIOR_PIPELINE_CONFIG } from '../src/application/behavior/BehaviorConfig';
import type { PromptDirector } from '../src/application/prompts/PromptDirector';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { StateEvolutionContext } from '../src/application/behavior/BehaviorTypes';

interface ChatGPTServiceConstructor {
  new (
    env: TestEnvService,
    prompts: PromptDirector,
    behaviorConfig: typeof DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
    logger: LoggerFactory
  ): ChatGPTServiceType;
}

const validDecision = {
  evolutionPatches: [],
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

describe('ChatGPTService proposeStateEvolution', () => {
  let ChatGPTService: ChatGPTServiceConstructor;
  let service: ChatGPTServiceType;
  let openaiParse: ReturnType<typeof vi.fn>;
  let prompts: Record<string, unknown>;
  let env: TestEnvService;
  let loggerFactory: LoggerFactory;

  beforeEach(async () => {
    vi.resetModules();

    openaiParse = vi.fn();
    const openaiMock = {
      chat: { completions: { create: vi.fn(), parse: openaiParse } },
    };
    vi.doMock('openai', () => ({ default: vi.fn(() => openaiMock) }));

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
      createAnswerPrompt: vi.fn().mockResolvedValue([]),
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

  it('uses stateEvolution default model on non-high risk and returns not escalated', async () => {
    openaiParse.mockResolvedValue({
      choices: [{ message: { parsed: validDecision } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await service.proposeStateEvolution(makeContext('low'));

    expect(openaiParse).toHaveBeenCalledTimes(1);
    expect(openaiParse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().stateEvolution.default,
        response_format: expect.objectContaining({ type: 'json_schema' }),
      })
    );
    expect(result.metadata.escalated).toBe(false);
    expect(result.metadata.modelSlot).toBe('stateEvolution');
  });

  it('starts on escalation model when maxStateImpactRisk is high', async () => {
    openaiParse.mockResolvedValue({
      choices: [{ message: { parsed: validDecision } }],
      usage: {},
    });

    const result = await service.proposeStateEvolution(makeContext('high'));

    expect(openaiParse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: env.getModels().stateEvolution.escalation,
      })
    );
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.selectedModel).toBe(
      env.getModels().stateEvolution.escalation
    );
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

    openaiParse
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: radicalDecision } }],
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: radicalDecision } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

    const result = await service.proposeStateEvolution(makeContext('low'));

    expect(openaiParse).toHaveBeenCalledTimes(2);
    expect(openaiParse.mock.calls[1][0].model).toBe(
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

    openaiParse
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: radicalAdjust } }],
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: radicalAdjust } }],
        usage: {},
      });

    await service.proposeStateEvolution(makeContext('low'));
    expect(openaiParse).toHaveBeenCalledTimes(2);
  });

  it('re-runs on escalation model when schema parse fails on default model', async () => {
    openaiParse
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: null } }],
        usage: {},
      })
      .mockResolvedValueOnce({
        choices: [{ message: { parsed: validDecision } }],
        usage: {},
      });

    const result = await service.proposeStateEvolution(makeContext('low'));

    expect(openaiParse).toHaveBeenCalledTimes(2);
    expect(result.metadata.escalated).toBe(true);
    expect(result.metadata.escalationReason).toBe('schema_validation_failed');
  });

  it('uses zodResponseFormat with stateEvolutionDecisionSchema', async () => {
    openaiParse.mockResolvedValue({
      choices: [{ message: { parsed: validDecision } }],
      usage: {},
    });

    await service.proposeStateEvolution(makeContext('low'));

    expect(openaiParse).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: expect.objectContaining({
          type: 'json_schema',
          json_schema: expect.objectContaining({
            name: 'StateEvolutionDecision',
          }),
        }),
      })
    );
  });
});
