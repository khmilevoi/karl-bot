import { describe, expect, it, vi } from 'vitest';

import type { ChatMessenger } from '../src/application/interfaces/chat/ChatMessenger';
import type { EnvService } from '../src/application/interfaces/env/EnvService';
import type { MessageService } from '../src/application/interfaces/messages/MessageService';
import type { SummaryService } from '../src/application/interfaces/summaries/SummaryService';
import { DEFAULT_BEHAVIOR_PIPELINE_CONFIG } from '../src/application/behavior/BehaviorConfig';
import { DefaultBehaviorContextAssembler } from '../src/application/behavior/DefaultBehaviorContextAssembler';
import type { BehaviorGateDecision } from '../src/domain/behavior/schemas/gate';
import type { PersonalityStateRepository } from '../src/domain/repositories/PersonalityStateRepository';
import type { PoliticalStateRepository } from '../src/domain/repositories/PoliticalStateRepository';
import type { TruthRepository } from '../src/domain/repositories/TruthRepository';
import type { UserPoliticalProfileRepository } from '../src/domain/repositories/UserPoliticalProfileRepository';
import type { UserSocialProfileRepository } from '../src/domain/repositories/UserSocialProfileRepository';
import type { ChatMessage } from '../src/domain/messages/ChatMessage';

const gate: BehaviorGateDecision = {
  shouldDecide: true,
  confidence: 0.9,
  reason: 'direct_trigger',
  triggerMessageIds: [1],
  contextMessageIds: [],
  stateImpactRisk: 'medium',
};

function makeAssembler(overrides: {
  recent?: ChatMessage[];
  selected?: ChatMessage[];
  summary?: string;
  personality?: object | null;
  political?: object | null;
}) {
  const messages: MessageService = {
    addMessage: vi.fn(),
    getMessages: vi.fn(),
    getMessagesByIds: vi.fn().mockResolvedValue(overrides.selected ?? []),
    getCount: vi.fn(),
    getLastMessages: vi.fn().mockResolvedValue(overrides.recent ?? []),
    clearMessages: vi.fn(),
  } as unknown as MessageService;

  const summaries: SummaryService = {
    getSummary: vi.fn().mockResolvedValue(overrides.summary ?? ''),
  } as unknown as SummaryService;

  const personalityRepo: PersonalityStateRepository = {
    findByChatId: vi.fn().mockResolvedValue(overrides.personality ?? null),
    upsert: vi.fn(),
  } as unknown as PersonalityStateRepository;

  const politicalRepo: PoliticalStateRepository = {
    findByChatId: vi.fn().mockResolvedValue(overrides.political ?? null),
    upsert: vi.fn(),
  } as unknown as PoliticalStateRepository;

  const profileRepo: UserSocialProfileRepository = {
    findByChat: vi.fn().mockResolvedValue([]),
    findByChatAndUser: vi.fn(),
    upsert: vi.fn(),
  } as unknown as UserSocialProfileRepository;

  const userPoliticalRepo: UserPoliticalProfileRepository = {
    findByChat: vi.fn().mockResolvedValue([]),
    findByChatAndUser: vi.fn(),
    upsert: vi.fn(),
  } as unknown as UserPoliticalProfileRepository;

  const truthRepo: TruthRepository = {
    findByChatId: vi.fn().mockResolvedValue([]),
    add: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  } as unknown as TruthRepository;

  const messenger: ChatMessenger = {
    bot: {
      botInfo: { id: 999, username: 'assistant_bot' },
    },
  } as unknown as ChatMessenger;

  const env: EnvService = {
    getBotName: vi.fn().mockReturnValue('Bot'),
  } as unknown as EnvService;

  const assembler = new DefaultBehaviorContextAssembler(
    DEFAULT_BEHAVIOR_PIPELINE_CONFIG,
    messages,
    summaries,
    personalityRepo,
    politicalRepo,
    profileRepo,
    userPoliticalRepo,
    truthRepo,
    messenger,
    env
  );

  return { assembler, messages, summaries, personalityRepo, politicalRepo };
}

describe('DefaultBehaviorContextAssembler', () => {
  it('uses neutral defaults when personality/political rows are absent', async () => {
    const { assembler } = makeAssembler({ personality: null, political: null });
    const ctx = await assembler.assemble({
      chatId: 1,
      triggerMessageIds: [],
      contextMessageIds: [],
      gate,
    });

    expect(ctx.state.personality.chatId).toBe(1);
    expect(ctx.state.personality.identityNotes).toEqual([]);
    expect(ctx.state.political.chatId).toBe(1);
    expect(ctx.state.political.positions).toEqual([]);
  });

  it('loads recent history from MessageService', async () => {
    const recentMsg: ChatMessage = {
      id: 5,
      chatId: 1,
      role: 'user',
      content: 'hi',
    };
    const { assembler, messages } = makeAssembler({ recent: [recentMsg] });

    const ctx = await assembler.assemble({
      chatId: 1,
      triggerMessageIds: [],
      contextMessageIds: [],
      gate,
    });

    expect(messages.getLastMessages).toHaveBeenCalledWith(
      1,
      DEFAULT_BEHAVIOR_PIPELINE_CONFIG.recentHistoryLimit
    );
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].id).toBe(5);
  });

  it('fetches explicit selected ids and deduplicates by id, sorted ascending', async () => {
    const recent: ChatMessage[] = [
      { id: 2, chatId: 1, role: 'assistant', content: 'a' },
      { id: 3, chatId: 1, role: 'user', content: 'b' },
    ];
    const selected: ChatMessage[] = [
      { id: 1, chatId: 1, role: 'user', content: 'old' },
      { id: 2, chatId: 1, role: 'assistant', content: 'a' },
    ];
    const { assembler, messages } = makeAssembler({ recent, selected });

    const ctx = await assembler.assemble({
      chatId: 1,
      triggerMessageIds: [1],
      contextMessageIds: [2],
      gate,
    });

    expect(messages.getMessagesByIds).toHaveBeenCalledWith([1, 2]);
    expect(ctx.messages.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('includes batch message ids in selected lookup and context', async () => {
    const selected: ChatMessage[] = [
      { id: 1, chatId: 1, role: 'user', content: 'trigger' },
      { id: 2, chatId: 1, role: 'user', content: 'context' },
      { id: 4, chatId: 1, role: 'user', content: 'batch' },
    ];
    const { assembler, messages } = makeAssembler({ selected });

    const ctx = await assembler.assemble({
      chatId: 1,
      triggerMessageIds: [1],
      contextMessageIds: [2],
      batchMessageIds: [4],
      gate,
    });

    expect(messages.getMessagesByIds).toHaveBeenCalledWith([1, 2, 4]);
    expect(ctx.batchMessageIds).toEqual([4]);
    expect(ctx.messages.map((m) => m.id)).toEqual([1, 2, 4]);
  });

  it('includes summary, profiles, and truths', async () => {
    const { assembler } = makeAssembler({ summary: 'prev-summary' });
    const ctx = await assembler.assemble({
      chatId: 1,
      triggerMessageIds: [],
      contextMessageIds: [],
      gate,
    });

    expect(ctx.summary).toBe('prev-summary');
    expect(ctx.state.profiles).toEqual([]);
    expect(ctx.state.truths).toEqual([]);
  });

  it('populates selfIdentity from messenger + env', async () => {
    const { assembler } = makeAssembler({});
    const ctx = await assembler.assemble({
      chatId: -100,
      triggerMessageIds: [],
      contextMessageIds: [],
      gate,
    });

    expect(ctx.selfIdentity).toEqual({
      id: 999,
      username: 'assistant_bot',
      name: 'Bot',
    });
  });
});
