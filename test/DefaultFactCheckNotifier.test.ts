import { describe, expect, it, vi } from 'vitest';

import { DefaultFactCheckNotifier } from '../src/application/fact-checking/DefaultFactCheckNotifier';
import type { FactCheckConfig } from '../src/application/fact-checking/FactCheckConfig';
import type { FactCheckStatsService } from '../src/application/fact-checking/FactCheckStatsService';
import type { ChatMessenger } from '../src/application/interfaces/chat/ChatMessenger';
import type { FactCheckFindingRepository } from '../src/domain/repositories/FactCheckRepository';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { FactCheckFindingWithSources } from '../src/domain/entities/FactCheckFindingEntity';

function makeConfig(): FactCheckConfig {
  return {
    enabled: true,
    hourlyCron: '',
    dailyStatsCron: '',
    weeklyStatsCron: '',
    monthlyStatsCron: '',
    timezone: 'UTC',
    maxMessagesPerBatch: 20,
    maxClaimsPerBatch: 5,
    maxHistoryContextMessages: 10,
    maxSourceSearchesPerBatch: 3,
    maxSourcesPerFinding: 3,
    maxDisplayedSourcesPerFinding: 2,
    maxFindingsPerDigestMessage: 5,
    verificationConfidenceThreshold: 0.75,
  };
}

function makeLoggerFactory(): LoggerFactory {
  const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };
  return { create: () => logger } as unknown as LoggerFactory;
}

function makeFinding(id: number): FactCheckFindingWithSources {
  return {
    id,
    runId: 1,
    chatId: 1,
    messageId: 10,
    telegramMessageId: null,
    authorUserId: null,
    authorDisplayName: 'Alice',
    normalizedClaimKey: 'claim',
    claimText: 'The sky is green',
    originalQuote: 'The sky is green',
    correctedFact: 'The sky is blue',
    explanation: 'Basic meteorology',
    category: 'external_fact',
    severity: 'low',
    status: 'confirmed',
    confidence: 0.9,
    sourcePolicy: 'reliable_or_media_allowed',
    sourceRequirementsMet: true,
    messageUrl: null,
    immediateNotifiedAt: null,
    digestNotifiedAt: null,
    notificationError: null,
    createdAt: '2026-06-06T10:00:00.000Z',
    checkedAt: '2026-06-06T10:00:00.000Z',
    sources: [],
  };
}

describe('DefaultFactCheckNotifier', () => {
  it('sendImmediate sends and marks notified', async () => {
    const finding = makeFinding(1);
    const findingRepo = {
      findUnsentImmediate: vi.fn().mockResolvedValue([finding]),
      markImmediateNotified: vi.fn().mockResolvedValue(undefined),
      recordNotificationError: vi.fn(),
    } as unknown as FactCheckFindingRepository;
    const messenger = {
      sendMessage: vi.fn().mockResolvedValue(100),
    } as unknown as ChatMessenger;

    const notifier = new DefaultFactCheckNotifier(
      findingRepo,
      makeConfig(),
      messenger,
      {} as unknown as FactCheckStatsService,
      makeLoggerFactory()
    );

    await notifier.sendImmediate(42);

    expect(messenger.sendMessage).toHaveBeenCalledOnce();
    expect(messenger.sendMessage).toHaveBeenCalledWith(42, expect.stringContaining('Фактчек'), expect.anything());
    expect(findingRepo.markImmediateNotified).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('sendImmediate records error when send fails', async () => {
    const finding = makeFinding(2);
    const findingRepo = {
      findUnsentImmediate: vi.fn().mockResolvedValue([finding]),
      markImmediateNotified: vi.fn(),
      recordNotificationError: vi.fn().mockResolvedValue(undefined),
    } as unknown as FactCheckFindingRepository;
    const messenger = {
      sendMessage: vi.fn().mockRejectedValue(new Error('network error')),
    } as unknown as ChatMessenger;

    const notifier = new DefaultFactCheckNotifier(
      findingRepo,
      makeConfig(),
      messenger,
      {} as unknown as FactCheckStatsService,
      makeLoggerFactory()
    );

    await notifier.sendImmediate(42);

    expect(findingRepo.markImmediateNotified).not.toHaveBeenCalled();
    expect(findingRepo.recordNotificationError).toHaveBeenCalledWith(2, 'network error');
  });

  it('sendHourlyDigest does nothing when no unsent findings', async () => {
    const findingRepo = {
      findUnsentDigest: vi.fn().mockResolvedValue([]),
    } as unknown as FactCheckFindingRepository;
    const messenger = { sendMessage: vi.fn() } as unknown as ChatMessenger;

    const notifier = new DefaultFactCheckNotifier(
      findingRepo, makeConfig(), messenger, {} as unknown as FactCheckStatsService, makeLoggerFactory()
    );

    await notifier.sendHourlyDigest(1);
    expect(messenger.sendMessage).not.toHaveBeenCalled();
  });

  it('sendHourlyDigest sends chunks and marks all notified', async () => {
    const findings = [makeFinding(10), makeFinding(11)];
    const findingRepo = {
      findUnsentDigest: vi.fn().mockResolvedValue(findings),
      markDigestNotified: vi.fn().mockResolvedValue(undefined),
    } as unknown as FactCheckFindingRepository;
    const messenger = {
      sendMessage: vi.fn().mockResolvedValue(99),
    } as unknown as ChatMessenger;

    const notifier = new DefaultFactCheckNotifier(
      findingRepo, makeConfig(), messenger, {} as unknown as FactCheckStatsService, makeLoggerFactory()
    );

    await notifier.sendHourlyDigest(1);
    expect(messenger.sendMessage).toHaveBeenCalled();
    expect(findingRepo.markDigestNotified).toHaveBeenCalledWith([10, 11], expect.any(String));
  });

  it('sendStats sends formatted stats message', async () => {
    const statsService = {
      getStatsSummary: vi.fn().mockResolvedValue('<b>Статистика</b>'),
    } as unknown as FactCheckStatsService;
    const messenger = {
      sendMessage: vi.fn().mockResolvedValue(1),
    } as unknown as ChatMessenger;
    const findingRepo = {} as unknown as FactCheckFindingRepository;

    const notifier = new DefaultFactCheckNotifier(
      findingRepo, makeConfig(), messenger, statsService, makeLoggerFactory()
    );

    await notifier.sendStats(5, 'weekly');

    expect(statsService.getStatsSummary).toHaveBeenCalledWith(5, 'weekly');
    expect(messenger.sendMessage).toHaveBeenCalledWith(5, '<b>Статистика</b>', expect.anything());
  });
});
