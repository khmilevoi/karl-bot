import { describe, expect, it, vi } from 'vitest';

import type { MessageService } from '../src/application/interfaces/messages/MessageService';
import type { SummaryService } from '../src/application/interfaces/summaries/SummaryService';
import { DEFAULT_STATE_EVOLUTION_CONFIG } from '../src/application/behavior/BehaviorConfig';
import { DefaultStateEvolutionContextAssembler } from '../src/application/behavior/DefaultStateEvolutionContextAssembler';
import type { BehaviorEventEntity } from '../src/domain/entities/BehaviorEventEntity';
import type { PersonalitySignalRepository } from '../src/domain/repositories/PersonalitySignalRepository';
import type { PersonalityStateRepository } from '../src/domain/repositories/PersonalityStateRepository';
import type { PoliticalStateRepository } from '../src/domain/repositories/PoliticalStateRepository';
import type { TruthRepository } from '../src/domain/repositories/TruthRepository';
import type { UserPoliticalProfileRepository } from '../src/domain/repositories/UserPoliticalProfileRepository';
import type { UserSocialProfileRepository } from '../src/domain/repositories/UserSocialProfileRepository';

function mkEvent(
  id: number,
  risk: string | null = 'medium',
  triggerIds: number[] = [],
  contextIds: number[] = []
): BehaviorEventEntity {
  return {
    id,
    chatId: 1,
    schemaVersion: 'v1',
    gateReason: null,
    gateConfidence: null,
    gateStateImpactRisk: risk,
    triggerMessageIdsJson: JSON.stringify(triggerIds),
    contextMessageIdsJson: JSON.stringify(contextIds),
    modelSlot: 'behaviorDecision',
    selectedModel: 'gpt-4o',
    escalated: false,
    escalationReason: null,
    actionsJson: '[]',
    actionResultsJson: '[]',
    statePatchesJson: '[]',
    patchResultsJson: '[]',
    confidence: 0.8,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    latencyMs: null,
    createdAt: new Date().toISOString(),
  };
}

function makeAssembler(overrides?: {
  personality?: object | null;
  political?: object | null;
  userPolitical?: object[];
  signals?: object[];
}) {
  const messages: MessageService = {
    addMessage: vi.fn(),
    getMessages: vi.fn(),
    getMessagesByIds: vi.fn().mockResolvedValue([]),
    getCount: vi.fn(),
    getLastMessages: vi.fn().mockResolvedValue([]),
    clearMessages: vi.fn(),
  } as unknown as MessageService;

  const summaries: SummaryService = {
    getSummary: vi.fn().mockResolvedValue('summary'),
  } as unknown as SummaryService;

  const personalityRepo: PersonalityStateRepository = {
    findByChatId: vi.fn().mockResolvedValue(overrides?.personality ?? null),
    upsert: vi.fn(),
  } as unknown as PersonalityStateRepository;

  const politicalRepo: PoliticalStateRepository = {
    findByChatId: vi.fn().mockResolvedValue(overrides?.political ?? null),
    upsert: vi.fn(),
  } as unknown as PoliticalStateRepository;

  const profileRepo: UserSocialProfileRepository = {
    findByChat: vi.fn().mockResolvedValue([]),
    findByChatAndUser: vi.fn(),
    upsert: vi.fn(),
  } as unknown as UserSocialProfileRepository;

  const userPoliticalRepo: UserPoliticalProfileRepository = {
    findByChat: vi.fn().mockResolvedValue(overrides?.userPolitical ?? []),
    findByChatAndUser: vi.fn(),
    upsert: vi.fn(),
  } as unknown as UserPoliticalProfileRepository;

  const truthRepo: TruthRepository = {
    findByChatId: vi.fn().mockResolvedValue([]),
    add: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  } as unknown as TruthRepository;

  const personalitySignalRepo: PersonalitySignalRepository = {
    add: vi.fn(),
    findByChatId: vi.fn().mockResolvedValue(overrides?.signals ?? []),
  } as unknown as PersonalitySignalRepository;

  return new DefaultStateEvolutionContextAssembler(
    DEFAULT_STATE_EVOLUTION_CONFIG,
    messages,
    summaries,
    personalityRepo,
    politicalRepo,
    profileRepo,
    userPoliticalRepo,
    truthRepo,
    personalitySignalRepo
  );
}

describe('DefaultStateEvolutionContextAssembler', () => {
  it('uses neutral defaults when personality/political rows are absent', async () => {
    const assembler = makeAssembler({ personality: null, political: null });
    const ctx = await assembler.assemble({
      chatId: 1,
      events: [mkEvent(1)],
    });
    expect(ctx.state.personality.chatId).toBe(1);
    expect(ctx.state.personality.identityNotes).toEqual([]);
    expect(ctx.state.political.chatId).toBe(1);
    expect(ctx.state.political.positions).toEqual([]);
    expect(ctx.state.political.compass).toEqual({
      economic: 0,
      social: 0,
      economicConfidence: 0,
      socialConfidence: 0,
    });
  });

  it('computes maxStateImpactRisk as the maximum over events', async () => {
    const assembler = makeAssembler();
    const ctx = await assembler.assemble({
      chatId: 1,
      events: [mkEvent(1, 'low'), mkEvent(2, 'high'), mkEvent(3, 'medium')],
    });
    expect(ctx.maxStateImpactRisk).toBe('high');
  });

  it('defaults maxStateImpactRisk to none when events have null risk', async () => {
    const assembler = makeAssembler();
    const ctx = await assembler.assemble({
      chatId: 1,
      events: [mkEvent(1, null)],
    });
    expect(ctx.maxStateImpactRisk).toBe('none');
  });

  it('extracts selected message ids from triggerMessageIds and contextMessageIds', async () => {
    const assembler = makeAssembler();
    const assemble = assembler as any;
    const msgs = assemble.messages ?? (assembler as any).messages;
    // Re-create to check what getMessagesByIds is called with
    const getMessagesByIds = vi.fn().mockResolvedValue([]);
    const getLastMessages = vi.fn().mockResolvedValue([]);

    const assembler2 = new DefaultStateEvolutionContextAssembler(
      DEFAULT_STATE_EVOLUTION_CONFIG,
      {
        getMessagesByIds,
        getLastMessages,
        addMessage: vi.fn(),
        getMessages: vi.fn(),
        getCount: vi.fn(),
        clearMessages: vi.fn(),
      } as unknown as typeof msgs,
      {
        getSummary: vi.fn().mockResolvedValue(''),
      } as unknown as SummaryService,
      { findByChatId: vi.fn().mockResolvedValue(null), upsert: vi.fn() } as any,
      { findByChatId: vi.fn().mockResolvedValue(null), upsert: vi.fn() } as any,
      {
        findByChat: vi.fn().mockResolvedValue([]),
        findByChatAndUser: vi.fn(),
        upsert: vi.fn(),
      } as any,
      {
        findByChat: vi.fn().mockResolvedValue([]),
        findByChatAndUser: vi.fn(),
        upsert: vi.fn(),
      } as any,
      {
        findByChatId: vi.fn().mockResolvedValue([]),
        add: vi.fn(),
        findById: vi.fn(),
        update: vi.fn(),
      } as any,
      { findByChatId: vi.fn().mockResolvedValue([]), add: vi.fn() } as any
    );

    await assembler2.assemble({
      chatId: 1,
      events: [mkEvent(1, 'medium', [10, 20], [15])],
    });

    expect(getMessagesByIds).toHaveBeenCalledWith(
      expect.arrayContaining([10, 15, 20])
    );
  });

  it('loads personality signals and user political profiles', async () => {
    const signals = [
      {
        area: 'identity',
        polarity: 'reinforce',
        text: 'curious',
        evidenceMessageIds: [],
        status: 'active',
        createdAt: '2026-05-31T00:00:00.000Z',
      },
    ];
    const userPolitical = [
      {
        chatId: 1,
        userId: 10,
        notes: [],
        compass: {
          economic: 0,
          social: 0,
          economicConfidence: 0,
          socialConfidence: 0,
        },
        updatedAt: '2026-05-31T00:00:00.000Z',
      },
    ];
    const assembler = makeAssembler({ signals, userPolitical });
    const ctx = await assembler.assemble({
      chatId: 1,
      events: [mkEvent(1)],
    });
    expect(ctx.personalitySignals).toEqual(signals);
    expect(ctx.state.userPolitical).toEqual(userPolitical);
  });

  it('returns empty triggerMessageIds, contextMessageIds, batchMessageIds', async () => {
    const assembler = makeAssembler();
    const ctx = await assembler.assemble({
      chatId: 1,
      events: [mkEvent(1)],
    });
    expect(ctx.triggerMessageIds).toEqual([]);
    expect(ctx.contextMessageIds).toEqual([]);
    expect(ctx.batchMessageIds).toEqual([]);
  });

  it('sets chatId on the returned context', async () => {
    const assembler = makeAssembler();
    const ctx = await assembler.assemble({
      chatId: 42,
      events: [mkEvent(1)],
    });
    expect(ctx.chatId).toBe(42);
  });

  it('loads recentMessageLimit messages from MessageService', async () => {
    const getLastMessages = vi.fn().mockResolvedValue([]);
    const assembler2 = new DefaultStateEvolutionContextAssembler(
      DEFAULT_STATE_EVOLUTION_CONFIG,
      {
        getLastMessages,
        getMessagesByIds: vi.fn().mockResolvedValue([]),
        addMessage: vi.fn(),
        getMessages: vi.fn(),
        getCount: vi.fn(),
        clearMessages: vi.fn(),
      } as unknown as MessageService,
      {
        getSummary: vi.fn().mockResolvedValue(''),
      } as unknown as SummaryService,
      { findByChatId: vi.fn().mockResolvedValue(null), upsert: vi.fn() } as any,
      { findByChatId: vi.fn().mockResolvedValue(null), upsert: vi.fn() } as any,
      {
        findByChat: vi.fn().mockResolvedValue([]),
        findByChatAndUser: vi.fn(),
        upsert: vi.fn(),
      } as any,
      {
        findByChat: vi.fn().mockResolvedValue([]),
        findByChatAndUser: vi.fn(),
        upsert: vi.fn(),
      } as any,
      {
        findByChatId: vi.fn().mockResolvedValue([]),
        add: vi.fn(),
        findById: vi.fn(),
        update: vi.fn(),
      } as any,
      { findByChatId: vi.fn().mockResolvedValue([]), add: vi.fn() } as any
    );

    await assembler2.assemble({ chatId: 1, events: [mkEvent(1)] });
    expect(getLastMessages).toHaveBeenCalledWith(
      1,
      DEFAULT_STATE_EVOLUTION_CONFIG.recentMessageLimit
    );
  });
});
