import { describe, expect, it, vi } from 'vitest';

import { DefaultFactCheckPipeline } from '../src/application/fact-checking/DefaultFactCheckPipeline';
import type { FactCheckConfig } from '../src/application/fact-checking/FactCheckConfig';
import type { FactCheckReasoningService } from '../src/application/fact-checking/FactCheckReasoningService';
import type { FactCheckNotifier } from '../src/application/fact-checking/FactCheckNotifier';
import type { SourceSearchService } from '../src/application/fact-checking/SourceSearchService';
import type { FactCheckMessageWindowRepository } from '../src/domain/repositories/FactCheckMessageWindowRepository';
import type { FactCheckWindowRepository } from '../src/domain/repositories/FactCheckWindowRepository';
import type { ChatRepository } from '../src/domain/repositories/ChatRepository';
import type {
  FactCheckRunRepository,
  FactCheckFindingRepository,
} from '../src/domain/repositories/FactCheckRepository';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { ChatMessage } from '../src/domain/messages/ChatMessage';

function makeConfig(overrides?: Partial<FactCheckConfig>): FactCheckConfig {
  return {
    enabled: true,
    hourlyCron: '0 * * * *',
    dailyStatsCron: '0 9 * * *',
    weeklyStatsCron: '0 9 * * 1',
    monthlyStatsCron: '0 9 1 * *',
    timezone: 'UTC',
    maxMessagesPerBatch: 20,
    maxClaimsPerBatch: 5,
    maxHistoryContextMessages: 10,
    maxSourceSearchesPerBatch: 3,
    maxSourcesPerFinding: 3,
    maxDisplayedSourcesPerFinding: 2,
    maxFindingsPerDigestMessage: 5,
    verificationConfidenceThreshold: 0.75,
    ...overrides,
  };
}

function makeLoggerFactory(): LoggerFactory {
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return this;
    },
  };
  return { create: () => logger } as unknown as LoggerFactory;
}

function makeBatchMessage(id: number): ChatMessage {
  return {
    id,
    role: 'user',
    content: `Message ${id}`,
    username: 'alice',
    userId: 1,
    messageId: id + 1000,
  };
}

describe('DefaultFactCheckPipeline', () => {
  it('returns skipped_disabled when config.enabled=false', async () => {
    const windowRepo = {
      findReadyByChatIdAfterId: vi.fn(),
      findReadyContextBeforeId: vi.fn(),
    } as unknown as FactCheckMessageWindowRepository;
    const pipeline = new DefaultFactCheckPipeline(
      makeConfig({ enabled: false }),
      windowRepo,
      { get: vi.fn(), upsert: vi.fn() } as unknown as FactCheckWindowRepository,
      { findById: vi.fn() } as unknown as ChatRepository,
      {} as unknown as FactCheckReasoningService,
      {} as unknown as SourceSearchService,
      {
        createRun: vi.fn(),
        completeRun: vi.fn(),
        failRun: vi.fn(),
      } as unknown as FactCheckRunRepository,
      { insertFinding: vi.fn() } as unknown as FactCheckFindingRepository,
      {
        sendImmediate: vi.fn(),
        sendHourlyDigest: vi.fn(),
        sendStats: vi.fn(),
      } as unknown as FactCheckNotifier,
      makeLoggerFactory()
    );

    const result = await pipeline.runHourly(123);
    expect(result.outcome).toBe('skipped_disabled');
    expect(result.runId).toBeNull();
    expect(windowRepo.findReadyByChatIdAfterId).not.toHaveBeenCalled();
  });

  it('returns skipped_no_messages when batch is empty', async () => {
    const cursorRepo = {
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    } as unknown as FactCheckWindowRepository;
    const windowRepo = {
      findReadyByChatIdAfterId: vi.fn().mockResolvedValue([]),
      findReadyContextBeforeId: vi.fn(),
    } as unknown as FactCheckMessageWindowRepository;

    const pipeline = new DefaultFactCheckPipeline(
      makeConfig(),
      windowRepo,
      cursorRepo,
      { findById: vi.fn() } as unknown as ChatRepository,
      {} as unknown as FactCheckReasoningService,
      {} as unknown as SourceSearchService,
      {
        createRun: vi.fn(),
        completeRun: vi.fn(),
        failRun: vi.fn(),
      } as unknown as FactCheckRunRepository,
      { insertFinding: vi.fn() } as unknown as FactCheckFindingRepository,
      {
        sendImmediate: vi.fn(),
        sendHourlyDigest: vi.fn(),
        sendStats: vi.fn(),
      } as unknown as FactCheckNotifier,
      makeLoggerFactory()
    );

    const result = await pipeline.runHourly(123);
    expect(result.outcome).toBe('skipped_no_messages');
    expect(cursorRepo.upsert).not.toHaveBeenCalled();
  });

  it('completes successfully and persists non-no_error findings', async () => {
    const chatId = 456;
    const batchMsg = makeBatchMessage(10);

    const cursorRepo = {
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as unknown as FactCheckWindowRepository;

    const windowRepo = {
      findReadyByChatIdAfterId: vi.fn().mockResolvedValue([batchMsg]),
      findReadyContextBeforeId: vi.fn().mockResolvedValue([]),
    } as unknown as FactCheckMessageWindowRepository;

    const chatRepo = {
      findById: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatRepository;

    const reasoning = {
      extractClaims: vi.fn().mockResolvedValue({
        result: {
          claims: [
            {
              messageId: 10,
              claimText: 'The Earth is flat',
              category: 'external_fact',
              needsExternalSources: false,
              riskLevel: 'low',
              whyCheckable: 'geography',
              contextMessageIds: [],
            },
          ],
        },
        metadata: {
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
      verifyClaims: vi.fn().mockResolvedValue({
        result: {
          findings: [
            {
              messageId: 10,
              claimText: 'The Earth is flat',
              status: 'confirmed',
              confidence: 0.9,
              correctedFact: 'The Earth is spherical',
              explanation: 'Well-established science',
              sourceRequirementsMet: true,
              sourceIndexes: [],
              shouldNotifyImmediately: true,
            },
          ],
        },
        metadata: {
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
    } as unknown as FactCheckReasoningService;

    const sourceSearch = {
      search: vi.fn().mockResolvedValue([]),
    } as unknown as SourceSearchService;

    const runRepo = {
      createRun: vi.fn().mockResolvedValue(42),
      completeRun: vi.fn().mockResolvedValue(undefined),
      failRun: vi.fn(),
    } as unknown as FactCheckRunRepository;

    const findingRepo = {
      insertFinding: vi.fn().mockResolvedValue(1),
    } as unknown as FactCheckFindingRepository;

    const notifier = {
      sendImmediate: vi.fn().mockResolvedValue(undefined),
      sendHourlyDigest: vi.fn().mockResolvedValue(undefined),
      sendStats: vi.fn(),
    } as unknown as FactCheckNotifier;

    const pipeline = new DefaultFactCheckPipeline(
      makeConfig(),
      windowRepo,
      cursorRepo,
      chatRepo,
      reasoning,
      sourceSearch,
      runRepo,
      findingRepo,
      notifier,
      makeLoggerFactory()
    );

    const result = await pipeline.runHourly(chatId);

    expect(result.outcome).toBe('completed');
    expect(result.runId).toBe(42);
    expect(result.processedMessages).toBe(1);
    expect(result.persistedFindings).toBe(1);

    expect(runRepo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId,
        runType: 'hourly',
        messageFromId: 10,
        messageToId: 10,
      })
    );
    expect(runRepo.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 42 })
    );
    expect(findingRepo.insertFinding).toHaveBeenCalledOnce();
    expect(cursorRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, lastCheckedMessageId: 10 })
    );
  });

  it('skips no_error findings from persistence', async () => {
    const batchMsg = makeBatchMessage(20);

    const cursorRepo = {
      get: vi.fn().mockResolvedValue({
        chatId: 1,
        lastCheckedMessageId: 5,
        lastCheckedAt: null,
        updatedAt: '',
      }),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as unknown as FactCheckWindowRepository;

    const windowRepo = {
      findReadyByChatIdAfterId: vi.fn().mockResolvedValue([batchMsg]),
      findReadyContextBeforeId: vi.fn().mockResolvedValue([]),
    } as unknown as FactCheckMessageWindowRepository;

    const reasoning = {
      extractClaims: vi.fn().mockResolvedValue({
        result: {
          claims: [
            {
              messageId: 20,
              claimText: 'claim',
              category: 'external_fact',
              needsExternalSources: false,
              riskLevel: 'low',
              whyCheckable: '',
              contextMessageIds: [],
            },
          ],
        },
        metadata: {
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
      verifyClaims: vi.fn().mockResolvedValue({
        result: {
          findings: [
            {
              messageId: 20,
              claimText: 'claim',
              status: 'no_error',
              confidence: 1.0,
              correctedFact: '',
              explanation: '',
              sourceRequirementsMet: true,
              sourceIndexes: [],
              shouldNotifyImmediately: false,
            },
          ],
        },
        metadata: {
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
    } as unknown as FactCheckReasoningService;

    const findingRepo = {
      insertFinding: vi.fn(),
    } as unknown as FactCheckFindingRepository;
    const runRepo = {
      createRun: vi.fn().mockResolvedValue(99),
      completeRun: vi.fn().mockResolvedValue(undefined),
      failRun: vi.fn(),
    } as unknown as FactCheckRunRepository;

    const pipeline = new DefaultFactCheckPipeline(
      makeConfig(),
      windowRepo,
      cursorRepo,
      {
        findById: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatRepository,
      reasoning,
      {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as SourceSearchService,
      runRepo,
      findingRepo,
      {
        sendImmediate: vi.fn().mockResolvedValue(undefined),
        sendHourlyDigest: vi.fn().mockResolvedValue(undefined),
        sendStats: vi.fn(),
      } as unknown as FactCheckNotifier,
      makeLoggerFactory()
    );

    const result = await pipeline.runHourly(1);
    expect(result.outcome).toBe('completed');
    expect(result.persistedFindings).toBe(0);
    expect(findingRepo.insertFinding).not.toHaveBeenCalled();
  });

  it('downgrades confirmed findings when verifier source requirements are not met', async () => {
    const chatId = 456;
    const batchMsg = makeBatchMessage(11);

    const cursorRepo = {
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as unknown as FactCheckWindowRepository;
    const windowRepo = {
      findReadyByChatIdAfterId: vi.fn().mockResolvedValue([batchMsg]),
      findReadyContextBeforeId: vi.fn().mockResolvedValue([]),
    } as unknown as FactCheckMessageWindowRepository;
    const reasoning = {
      extractClaims: vi.fn().mockResolvedValue({
        result: {
          claims: [
            {
              messageId: 11,
              claimText: 'A city changed its name yesterday',
              category: 'external_fact',
              needsExternalSources: true,
              riskLevel: 'low',
              whyCheckable: 'external factual claim',
              contextMessageIds: [],
            },
          ],
        },
        metadata: {
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
      verifyClaims: vi.fn().mockResolvedValue({
        result: {
          findings: [
            {
              messageId: 11,
              claimText: 'A city changed its name yesterday',
              status: 'confirmed',
              confidence: 0.9,
              correctedFact: 'The city did not change its name.',
              explanation: 'Verifier could not satisfy source policy.',
              sourceRequirementsMet: false,
              sourceIndexes: [0],
              shouldNotifyImmediately: false,
            },
          ],
        },
        metadata: {
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
    } as unknown as FactCheckReasoningService;
    const findingRepo = {
      insertFinding: vi.fn().mockResolvedValue(1),
    } as unknown as FactCheckFindingRepository;

    const pipeline = new DefaultFactCheckPipeline(
      makeConfig(),
      windowRepo,
      cursorRepo,
      {
        findById: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatRepository,
      reasoning,
      {
        search: vi.fn().mockResolvedValue([
          {
            url: 'https://example.com/story',
            title: 'Story',
            publisher: 'Example',
            snippet: 'Snippet',
            reliability: 'media',
            retrievedAt: '2026-06-06T00:00:00.000Z',
          },
        ]),
      } as unknown as SourceSearchService,
      {
        createRun: vi.fn().mockResolvedValue(42),
        completeRun: vi.fn().mockResolvedValue(undefined),
        failRun: vi.fn(),
      } as unknown as FactCheckRunRepository,
      findingRepo,
      {
        sendImmediate: vi.fn().mockResolvedValue(undefined),
        sendHourlyDigest: vi.fn().mockResolvedValue(undefined),
        sendStats: vi.fn(),
      } as unknown as FactCheckNotifier,
      makeLoggerFactory()
    );

    await pipeline.runHourly(chatId);

    expect(findingRepo.insertFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'uncertain',
        sourceRequirementsMet: false,
      })
    );
  });

  it('matches verifier findings to the exact extracted claim text', async () => {
    const chatId = 456;
    const batchMsg = makeBatchMessage(10);

    const cursorRepo = {
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as unknown as FactCheckWindowRepository;
    const windowRepo = {
      findReadyByChatIdAfterId: vi.fn().mockResolvedValue([batchMsg]),
      findReadyContextBeforeId: vi.fn().mockResolvedValue([]),
    } as unknown as FactCheckMessageWindowRepository;
    const reasoning = {
      extractClaims: vi.fn().mockResolvedValue({
        result: {
          claims: [
            {
              messageId: 10,
              claimText: 'The sky is green',
              category: 'external_fact',
              riskLevel: 'low',
              needsExternalSources: true,
              whyCheckable: 'color claim',
              contextMessageIds: [],
            },
            {
              messageId: 10,
              claimText: 'This pill cures cancer',
              category: 'medical',
              riskLevel: 'high',
              needsExternalSources: true,
              whyCheckable: 'medical treatment claim',
              contextMessageIds: [],
            },
          ],
        },
        metadata: {
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
      verifyClaims: vi.fn().mockResolvedValue({
        result: {
          findings: [
            {
              messageId: 10,
              claimText: 'This pill cures cancer',
              status: 'confirmed',
              confidence: 0.9,
              correctedFact: 'No pill cures all cancer.',
              explanation: 'Cancer treatments depend on diagnosis.',
              sourceRequirementsMet: true,
              sourceIndexes: [0],
              shouldNotifyImmediately: true,
            },
          ],
        },
        metadata: {
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
    } as unknown as FactCheckReasoningService;
    const findingRepo = {
      insertFinding: vi.fn().mockResolvedValue(1),
    } as unknown as FactCheckFindingRepository;

    const pipeline = new DefaultFactCheckPipeline(
      makeConfig(),
      windowRepo,
      cursorRepo,
      {
        findById: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatRepository,
      reasoning,
      {
        search: vi.fn().mockResolvedValue([
          {
            url: 'https://example.com/medical',
            title: 'Medical source',
            publisher: 'Example Medical',
            snippet: 'Cancer treatment guidance',
            reliability: 'authoritative',
            retrievedAt: '2026-06-06T00:00:00.000Z',
          },
        ]),
      } as unknown as SourceSearchService,
      {
        createRun: vi.fn().mockResolvedValue(42),
        completeRun: vi.fn().mockResolvedValue(undefined),
        failRun: vi.fn(),
      } as unknown as FactCheckRunRepository,
      findingRepo,
      {
        sendImmediate: vi.fn().mockResolvedValue(undefined),
        sendHourlyDigest: vi.fn().mockResolvedValue(undefined),
        sendStats: vi.fn(),
      } as unknown as FactCheckNotifier,
      makeLoggerFactory()
    );

    await pipeline.runHourly(chatId);

    expect(findingRepo.insertFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'medical',
        severity: 'high',
        sourcePolicy: 'primary_required',
      })
    );
  });

  it('returns failed outcome when reasoning throws', async () => {
    const batchMsg = makeBatchMessage(30);

    const cursorRepo = {
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
    } as unknown as FactCheckWindowRepository;
    const windowRepo = {
      findReadyByChatIdAfterId: vi.fn().mockResolvedValue([batchMsg]),
      findReadyContextBeforeId: vi.fn().mockResolvedValue([]),
    } as unknown as FactCheckMessageWindowRepository;
    const runRepo = {
      createRun: vi.fn().mockResolvedValue(7),
      completeRun: vi.fn(),
      failRun: vi.fn().mockResolvedValue(undefined),
    } as unknown as FactCheckRunRepository;
    const reasoning = {
      extractClaims: vi.fn().mockRejectedValue(new Error('AI error')),
      verifyClaims: vi.fn(),
    } as unknown as FactCheckReasoningService;

    const pipeline = new DefaultFactCheckPipeline(
      makeConfig(),
      windowRepo,
      cursorRepo,
      {
        findById: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatRepository,
      reasoning,
      { search: vi.fn() } as unknown as SourceSearchService,
      runRepo,
      { insertFinding: vi.fn() } as unknown as FactCheckFindingRepository,
      {
        sendImmediate: vi.fn(),
        sendHourlyDigest: vi.fn(),
        sendStats: vi.fn(),
      } as unknown as FactCheckNotifier,
      makeLoggerFactory()
    );

    const result = await pipeline.runHourly(1);
    expect(result.outcome).toBe('failed');
    expect(result.runId).toBe(7);
    expect(runRepo.failRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 7 })
    );
    expect(cursorRepo.upsert).not.toHaveBeenCalled();
  });

  it('runStats fires notifier and returns completed', async () => {
    const notifier = {
      sendImmediate: vi.fn(),
      sendHourlyDigest: vi.fn(),
      sendStats: vi.fn().mockResolvedValue(undefined),
    } as unknown as FactCheckNotifier;

    const pipeline = new DefaultFactCheckPipeline(
      makeConfig(),
      {} as unknown as FactCheckMessageWindowRepository,
      {} as unknown as FactCheckWindowRepository,
      {} as unknown as ChatRepository,
      {} as unknown as FactCheckReasoningService,
      {} as unknown as SourceSearchService,
      {} as unknown as FactCheckRunRepository,
      {} as unknown as FactCheckFindingRepository,
      notifier,
      makeLoggerFactory()
    );

    const result = await pipeline.runStats(111, 'daily');
    expect(result.outcome).toBe('completed');
    expect(result.chatId).toBe(111);
  });
});
