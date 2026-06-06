import { describe, expect, it, vi } from 'vitest';

import { DefaultFactCheckReasoningService } from '../src/application/fact-checking/DefaultFactCheckReasoningService';
import type { FactCheckConfig } from '../src/application/fact-checking/FactCheckConfig';
import type { AiGateway, AiParsedResult } from '../src/application/interfaces/ai/AiGateway';
import type { EnvService } from '../src/application/interfaces/env/EnvService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { PromptDirector } from '../src/application/prompts/PromptDirector';
import type {
  ClaimExtractionResult,
  FactVerificationResult,
} from '../src/domain/fact-checking/FactCheckSchemas';
import {
  claimExtractionResultJsonSchema,
  factVerificationResultJsonSchema,
} from '../src/domain/fact-checking/FactCheckSchemas';

const EXTRACTION_MODEL = 'gpt-5.4-mini';
const ESCALATION_MODEL = 'gpt-5.5';
const THRESHOLD = 0.75;

function makeEnvService(): EnvService {
  return {
    env: { LOG_PROMPTS: false } as EnvService['env'],
    getModels: () => ({
      triggerGate: { default: EXTRACTION_MODEL },
      behaviorDecision: { default: EXTRACTION_MODEL, escalation: ESCALATION_MODEL },
      summarization: { default: EXTRACTION_MODEL, escalation: ESCALATION_MODEL },
      stateEvolution: { default: EXTRACTION_MODEL, escalation: ESCALATION_MODEL },
      errorRepair: { default: EXTRACTION_MODEL, escalation: ESCALATION_MODEL },
      factCheckExtraction: { default: EXTRACTION_MODEL },
      factCheckVerification: {
        default: EXTRACTION_MODEL,
        escalation: ESCALATION_MODEL,
      },
      sourceSearch: { default: EXTRACTION_MODEL },
    }),
  } as unknown as EnvService;
}

function makePromptDirector(): PromptDirector {
  return {
    createFactCheckExtractionPrompt: vi.fn(async () => [
      { role: 'system', content: 'extract' },
    ]),
    createFactCheckVerificationPrompt: vi.fn(async () => [
      { role: 'system', content: 'verify' },
    ]),
  } as unknown as PromptDirector;
}

function makeLoggerFactory(): LoggerFactory {
  return {
    create: () => ({
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    }),
  } as unknown as LoggerFactory;
}

function makeConfig(threshold = THRESHOLD): FactCheckConfig {
  return {
    enabled: false,
    hourlyCron: '0 0 * * * *',
    dailyStatsCron: '0 0 9 * * *',
    weeklyStatsCron: '0 0 9 * * 1',
    monthlyStatsCron: '0 0 9 1 * *',
    timezone: 'Europe/Warsaw',
    maxMessagesPerBatch: 200,
    maxClaimsPerBatch: 40,
    maxHistoryContextMessages: 100,
    maxSourceSearchesPerBatch: 20,
    maxSourcesPerFinding: 5,
    maxDisplayedSourcesPerFinding: 3,
    maxFindingsPerDigestMessage: 10,
    verificationConfidenceThreshold: threshold,
  };
}

const dummyUsage = {
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
};

const extractionResult: ClaimExtractionResult = { claims: [] };
const verificationResult: FactVerificationResult = { findings: [] };

function makeResultFor<T>(parsed: T | null, raw: unknown = { ok: true }): AiParsedResult<T> {
  return { parsed, model: EXTRACTION_MODEL, usage: dummyUsage, raw };
}

function makeService(
  gateway: AiGateway,
  config?: FactCheckConfig,
  director?: PromptDirector
): DefaultFactCheckReasoningService {
  return new DefaultFactCheckReasoningService(
    makeEnvService(),
    director ?? makePromptDirector(),
    gateway,
    config ?? makeConfig(),
    makeLoggerFactory()
  );
}

const emptyExtractionInput = { batchMessages: [], contextMessages: [] };
const emptyVerifyInput = {
  candidates: [],
  batchMessages: [],
  contextMessages: [],
  sources: [],
};

describe('DefaultFactCheckReasoningService', () => {
  describe('extractClaims', () => {
    it('calls parseChatCompletion with extraction model', async () => {
      const parseChatCompletion = vi.fn(async () =>
        makeResultFor(extractionResult)
      );
      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await makeService(gateway).extractClaims(emptyExtractionInput);

      expect(parseChatCompletion).toHaveBeenCalledOnce();
      expect(parseChatCompletion.mock.calls[0][0].model).toBe(EXTRACTION_MODEL);
    });

    it('passes claimExtractionResultJsonSchema as responseFormat', async () => {
      const parseChatCompletion = vi.fn(async () =>
        makeResultFor(extractionResult)
      );
      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await makeService(gateway).extractClaims(emptyExtractionInput);

      expect(parseChatCompletion.mock.calls[0][0].responseFormat).toBe(
        claimExtractionResultJsonSchema
      );
    });

    it('returns result with correct metadata', async () => {
      const raw = { result: 'raw-data' };
      const parseChatCompletion = vi.fn(async () =>
        makeResultFor(extractionResult, raw)
      );
      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      const out = await makeService(gateway).extractClaims(emptyExtractionInput);

      expect(out.result).toEqual(extractionResult);
      expect(out.metadata.modelSlot).toBe('factCheckExtraction');
      expect(out.metadata.selectedModel).toBe(EXTRACTION_MODEL);
      expect(out.metadata.escalated).toBe(false);
      expect(out.metadata.escalationReason).toBeNull();
      expect(out.metadata.latencyMs).toBeGreaterThanOrEqual(0);
      expect(out.metadata.usage).toEqual(dummyUsage);
      expect(out.responseJson).toEqual(raw);
    });

    it('throws when parsed is null', async () => {
      const parseChatCompletion = vi.fn(async () =>
        makeResultFor<ClaimExtractionResult>(null)
      );
      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await expect(
        makeService(gateway).extractClaims(emptyExtractionInput)
      ).rejects.toThrow('Failed to parse fact-check extraction response');
    });
  });

  describe('verifyClaims', () => {
    it('uses verification model on first call', async () => {
      const parseChatCompletion = vi.fn(async () =>
        makeResultFor(verificationResult)
      );
      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await makeService(gateway).verifyClaims(emptyVerifyInput);

      expect(parseChatCompletion).toHaveBeenCalledOnce();
      expect(parseChatCompletion.mock.calls[0][0].model).toBe(EXTRACTION_MODEL);
    });

    it('passes factVerificationResultJsonSchema as responseFormat', async () => {
      const parseChatCompletion = vi.fn(async () =>
        makeResultFor(verificationResult)
      );
      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await makeService(gateway).verifyClaims(emptyVerifyInput);

      expect(parseChatCompletion.mock.calls[0][0].responseFormat).toBe(
        factVerificationResultJsonSchema
      );
    });

    it('does not escalate when confidence is above threshold', async () => {
      const highConf: FactVerificationResult = {
        findings: [
          {
            messageId: 1,
            claimText: 'c',
            status: 'confirmed',
            confidence: 0.95,
            correctedFact: 'f',
            explanation: 'e',
            sourceRequirementsMet: true,
            sourceIndexes: [],
            shouldNotifyImmediately: false,
          },
        ],
      };
      const parseChatCompletion = vi.fn(async () => makeResultFor(highConf));
      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await makeService(gateway, makeConfig(0.75)).verifyClaims(emptyVerifyInput);

      expect(parseChatCompletion).toHaveBeenCalledOnce();
    });

    it('does not escalate for no_error findings regardless of confidence', async () => {
      const noError: FactVerificationResult = {
        findings: [
          {
            messageId: 1,
            claimText: 'c',
            status: 'no_error',
            confidence: 0.1,
            correctedFact: '',
            explanation: 'no error',
            sourceRequirementsMet: true,
            sourceIndexes: [],
            shouldNotifyImmediately: false,
          },
        ],
      };
      const parseChatCompletion = vi.fn(async () => makeResultFor(noError));
      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await makeService(gateway, makeConfig(0.75)).verifyClaims(emptyVerifyInput);

      expect(parseChatCompletion).toHaveBeenCalledOnce();
    });

    it('escalates when a finding confidence is below threshold', async () => {
      const lowConf: FactVerificationResult = {
        findings: [
          {
            messageId: 1,
            claimText: 'c',
            status: 'confirmed',
            confidence: 0.5,
            correctedFact: 'f',
            explanation: 'e',
            sourceRequirementsMet: false,
            sourceIndexes: [],
            shouldNotifyImmediately: false,
          },
        ],
      };
      const parseChatCompletion = vi
        .fn()
        .mockResolvedValueOnce(makeResultFor(lowConf))
        .mockResolvedValueOnce(makeResultFor(verificationResult));

      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await makeService(gateway, makeConfig(0.75)).verifyClaims(emptyVerifyInput);

      expect(parseChatCompletion).toHaveBeenCalledTimes(2);
      expect(parseChatCompletion.mock.calls[1][0].model).toBe(ESCALATION_MODEL);
    });

    it('escalates when parsed is null on first call', async () => {
      const parseChatCompletion = vi
        .fn()
        .mockResolvedValueOnce(makeResultFor<FactVerificationResult>(null))
        .mockResolvedValueOnce(makeResultFor(verificationResult));

      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await makeService(gateway).verifyClaims(emptyVerifyInput);

      expect(parseChatCompletion).toHaveBeenCalledTimes(2);
      expect(parseChatCompletion.mock.calls[1][0].model).toBe(ESCALATION_MODEL);
    });

    it('throws when escalation also returns null', async () => {
      const parseChatCompletion = vi
        .fn()
        .mockResolvedValue(makeResultFor<FactVerificationResult>(null));

      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      await expect(
        makeService(gateway).verifyClaims(emptyVerifyInput)
      ).rejects.toThrow('Failed to parse fact-check verification response');
    });

    it('returns escalated=true in metadata when escalation occurred', async () => {
      const lowConf: FactVerificationResult = {
        findings: [
          {
            messageId: 1,
            claimText: 'c',
            status: 'uncertain',
            confidence: 0.3,
            correctedFact: 'f',
            explanation: 'e',
            sourceRequirementsMet: false,
            sourceIndexes: [],
            shouldNotifyImmediately: false,
          },
        ],
      };
      const parseChatCompletion = vi
        .fn()
        .mockResolvedValueOnce(makeResultFor(lowConf))
        .mockResolvedValueOnce(makeResultFor(verificationResult, { esc: true }));

      const gateway = { parseChatCompletion, createResponse: vi.fn() } as unknown as AiGateway;
      const out = await makeService(gateway, makeConfig(0.75)).verifyClaims(emptyVerifyInput);

      expect(out.metadata.escalated).toBe(true);
      expect(out.metadata.escalationReason).toBe('low_confidence');
      expect(out.metadata.selectedModel).toBe(ESCALATION_MODEL);
      expect(out.responseJson).toEqual({ esc: true });
    });
  });
});
