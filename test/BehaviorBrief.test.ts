import { describe, expect, it } from 'vitest';

import { buildBehaviorBrief } from '@/application/prompts/BehaviorBrief';
import type {
  BehaviorPromptMessage,
  BehaviorPromptState,
} from '@/application/prompts/PromptTypes';

function emptyState(chatId = -100): BehaviorPromptState {
  const now = '2026-06-05T00:00:00.000Z';
  return {
    personality: {
      chatId,
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
      lastUpdatedAt: now,
    },
    political: {
      chatId,
      ideologySummary: '',
      compass: {
        economic: 0,
        social: 0,
        economicConfidence: 0,
        socialConfidence: 0,
      },
      positions: [],
      uncertaintyAreas: [],
      influenceHistory: [],
      lastUpdatedAt: now,
    },
    profiles: [],
    truths: [],
    userPolitical: [],
  };
}

function msg(
  id: number,
  userId: number,
  username: string
): BehaviorPromptMessage {
  return {
    id,
    chatId: -100,
    role: 'user',
    content: 'hi',
    userId,
    username,
  } as BehaviorPromptMessage;
}

describe('buildBehaviorBrief', () => {
  it('returns reserved-mode text on empty state', () => {
    const brief = buildBehaviorBrief({
      state: emptyState(),
      messages: [msg(1, 7, 'oleg')],
    });
    expect(brief).toContain('отношений пока нет');
    expect(brief).toContain('характер ещё не сформирован');
  });

  it('renders a mocking relationship card with cold tone and mocking emoji lean', () => {
    const state = emptyState();
    state.profiles = [
      {
        userId: 7,
        chatId: -100,
        username: 'oleg',
        affinityScore: -2,
        labels: [],
        patterns: [],
        grudges: [
          { text: 'слил дедлайн', evidenceMessageIds: [1], status: 'active' },
        ],
        trustLevel: 'low',
        preferredDistance: 'mocking',
        communicationStyle: '',
        conflictStyle: '',
        preferredTone: '',
        interests: [],
        updatedAt: '2026-06-05T00:00:00.000Z',
      },
    ];
    const brief = buildBehaviorBrief({ state, messages: [msg(1, 7, 'oleg')] });
    expect(brief).toContain('@oleg');
    expect(brief).toContain('колко');
    expect(brief).toContain('🤡');
    expect(brief).toContain('слил дедлайн');
  });

  it('includes identity line when selfIdentity provided', () => {
    const brief = buildBehaviorBrief({
      state: emptyState(),
      messages: [msg(1, 7, 'oleg')],
      selfIdentity: { id: 999, username: 'carl_bot', name: 'Карл' },
    });
    expect(brief).toContain('@carl_bot');
    expect(brief).toContain('Карл');
  });
});
