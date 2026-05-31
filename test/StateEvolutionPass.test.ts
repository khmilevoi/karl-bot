import { describe, expect, it, vi } from 'vitest';

import type { AiErrorLogger } from '../src/application/behavior/AiErrorLogger';
import type { BehaviorAiService } from '../src/application/behavior/BehaviorAiService';
import type { BehaviorEventLogger } from '../src/application/behavior/BehaviorEventLogger';
import { DefaultStateEvolutionPass } from '../src/application/behavior/DefaultStateEvolutionPass';
import type { StateEvolutionContextAssembler } from '../src/application/behavior/StateEvolutionContextAssembler';
import type { StatePatchApplicator } from '../src/application/behavior/StatePatchApplicator';
import type {
  StateEvolutionContext,
  StateEvolutionResult,
} from '../src/application/behavior/BehaviorTypes';
import type { BehaviorEventRepository } from '../src/domain/repositories/BehaviorEventRepository';
import type { PersonalityStateRepository } from '../src/domain/repositories/PersonalityStateRepository';
import type { PoliticalStateRepository } from '../src/domain/repositories/PoliticalStateRepository';
import type { StateEvolutionCursorRepository } from '../src/domain/repositories/StateEvolutionCursorRepository';
import type { UserPoliticalProfileRepository } from '../src/domain/repositories/UserPoliticalProfileRepository';
import type { UserSocialProfileRepository } from '../src/domain/repositories/UserSocialProfileRepository';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const now = '2026-05-31T00:00:00.000Z';

function mkEvent(id: number, slot = 'behaviorDecision') {
  return {
    id,
    chatId: 1,
    schemaVersion: 'v1',
    gateReason: null,
    gateConfidence: null,
    gateStateImpactRisk: 'medium',
    triggerMessageIdsJson: '[]',
    contextMessageIdsJson: '[]',
    modelSlot: slot,
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
    createdAt: now,
  };
}

const baseDecision = {
  evolutionPatches: [],
  personalitySnapshot: {
    identityNotes: ['curious'],
    values: ['honesty'],
    speechStyle: {
      tone: 'dry',
      humor: 'none',
      verbosity: 'short' as const,
      formality: 'medium' as const,
    },
    socialHabits: [],
    recurringThemes: [],
  },
  userSnapshots: [],
  botCompass: {
    economic: 2,
    social: -1,
    economicConfidence: 0.6,
    socialConfidence: 0.3,
  },
  userPoliticalSnapshots: [],
};

const baseContext: StateEvolutionContext = {
  chatId: 1,
  maxStateImpactRisk: 'medium',
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

function makeResult(
  overrides?: Partial<typeof baseDecision>
): StateEvolutionResult {
  return {
    decision: { ...baseDecision, ...overrides },
    metadata: {
      modelSlot: 'stateEvolution',
      selectedModel: 'gpt-5.4-mini' as any,
      escalated: false,
      escalationReason: null,
      latencyMs: 200,
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    },
  };
}

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  }) as unknown as LoggerFactory;

function makePass(overrides?: {
  cursor?: Partial<StateEvolutionCursorRepository>;
  events?: Partial<BehaviorEventRepository>;
  assembler?: Partial<StateEvolutionContextAssembler>;
  ai?: Partial<BehaviorAiService>;
  applicator?: Partial<StatePatchApplicator>;
  personalityRepo?: Partial<PersonalityStateRepository>;
  politicalRepo?: Partial<PoliticalStateRepository>;
  socialProfileRepo?: Partial<UserSocialProfileRepository>;
  userPoliticalRepo?: Partial<UserPoliticalProfileRepository>;
  eventLogger?: Partial<BehaviorEventLogger>;
  errorLogger?: Partial<AiErrorLogger>;
}) {
  const cursorRepo: StateEvolutionCursorRepository = {
    get: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    findChatsNeedingSweep: vi.fn().mockResolvedValue([]),
    ...overrides?.cursor,
  };
  const eventRepo: BehaviorEventRepository = {
    insert: vi.fn().mockResolvedValue(1),
    findById: vi.fn(),
    findByChatId: vi.fn().mockResolvedValue([]),
    findByChatIdAfter: vi.fn().mockResolvedValue([]),
    countByChatIdAfter: vi.fn().mockResolvedValue(0),
    ...overrides?.events,
  };
  const assembler: StateEvolutionContextAssembler = {
    assemble: vi.fn().mockResolvedValue(baseContext),
    ...overrides?.assembler,
  };
  const ai: BehaviorAiService = {
    evaluateGate: vi.fn(),
    decideBehavior: vi.fn(),
    proposeStateEvolution: vi.fn().mockResolvedValue(makeResult()),
    ...overrides?.ai,
  };
  const applicator: StatePatchApplicator = {
    applyPatches: vi.fn().mockResolvedValue([]),
    applyEvolutionPatches: vi.fn().mockResolvedValue([]),
    ...overrides?.applicator,
  };
  const personalityRepo: PersonalityStateRepository = {
    findByChatId: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...overrides?.personalityRepo,
  };
  const politicalRepo: PoliticalStateRepository = {
    findByChatId: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...overrides?.politicalRepo,
  };
  const socialProfileRepo: UserSocialProfileRepository = {
    findByChatAndUser: vi.fn().mockResolvedValue(undefined),
    findByChat: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...overrides?.socialProfileRepo,
  };
  const userPoliticalRepo: UserPoliticalProfileRepository = {
    findByChatAndUser: vi.fn().mockResolvedValue(undefined),
    findByChat: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...overrides?.userPoliticalRepo,
  };
  const eventLogger: BehaviorEventLogger = {
    logDecision: vi.fn(),
    logEvolution: vi.fn().mockResolvedValue(100),
    ...overrides?.eventLogger,
  };
  const errorLogger: AiErrorLogger = {
    log: vi.fn().mockResolvedValue(999),
    ...overrides?.errorLogger,
  };

  return new DefaultStateEvolutionPass(
    cursorRepo,
    eventRepo,
    assembler,
    ai,
    applicator,
    personalityRepo,
    politicalRepo,
    socialProfileRepo,
    userPoliticalRepo,
    eventLogger,
    errorLogger,
    createLoggerFactory()
  );
}

describe('DefaultStateEvolutionPass', () => {
  it('returns skipped when no live events since cursor', async () => {
    const cursorUpsert = vi.fn().mockResolvedValue(undefined);
    const pass = makePass({
      events: {
        findByChatIdAfter: vi
          .fn()
          .mockResolvedValue([mkEvent(5, 'stateEvolution')]),
      },
      cursor: { upsert: cursorUpsert },
    });

    const result = await pass.run(1);

    expect(result.kind).toBe('skipped');
    expect(cursorUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 5, chatId: 1 })
    );
  });

  it('returns evolved and advances cursor on happy path', async () => {
    const liveEvent = mkEvent(3, 'behaviorDecision');
    const cursorUpsert = vi.fn().mockResolvedValue(undefined);

    const pass = makePass({
      events: {
        findByChatIdAfter: vi.fn().mockResolvedValue([liveEvent]),
      },
      cursor: { upsert: cursorUpsert },
      eventLogger: { logEvolution: vi.fn().mockResolvedValue(50) },
    });

    const result = await pass.run(1);

    expect(result.kind).toBe('evolved');
    if (result.kind === 'evolved') {
      expect(result.behaviorEventId).toBe(50);
    }
    expect(cursorUpsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ lastEventId: 50, chatId: 1 })
    );
  });

  it('clamps botCompass axes to [-10, 10] when writing', async () => {
    const liveEvent = mkEvent(3);
    const politicalUpsert = vi.fn().mockResolvedValue(undefined);

    const pass = makePass({
      events: { findByChatIdAfter: vi.fn().mockResolvedValue([liveEvent]) },
      ai: {
        proposeStateEvolution: vi.fn().mockResolvedValue(
          makeResult({
            botCompass: {
              economic: 99,
              social: -99,
              economicConfidence: -0.5,
              socialConfidence: 1.5,
            },
          })
        ),
      },
      politicalRepo: {
        findByChatId: vi.fn().mockResolvedValue(null),
        upsert: politicalUpsert,
      },
    });

    await pass.run(1);

    expect(politicalUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        compass: {
          economic: 10,
          social: -10,
          economicConfidence: 0,
          socialConfidence: 1,
        },
      })
    );
  });

  it('writes personality snapshot rendered fields only', async () => {
    const liveEvent = mkEvent(3);
    const personalityUpsert = vi.fn().mockResolvedValue(undefined);
    const existingPersonality = {
      chatId: 1,
      identityNotes: ['old note'],
      values: ['old value'],
      speechStyle: {
        tone: 'sarcastic',
        humor: 'dry',
        verbosity: 'essay' as const,
        formality: 'low' as const,
      },
      socialHabits: ['old habit'],
      recurringThemes: ['old theme'],
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
    };

    const pass = makePass({
      events: { findByChatIdAfter: vi.fn().mockResolvedValue([liveEvent]) },
      ai: {
        proposeStateEvolution: vi.fn().mockResolvedValue(
          makeResult({
            personalitySnapshot: {
              identityNotes: ['curious'],
              values: ['honesty'],
              speechStyle: {
                tone: 'dry',
                humor: 'sarcastic',
                verbosity: 'short',
                formality: 'medium',
              },
              socialHabits: ['lurks'],
              recurringThemes: ['freedom'],
            },
          })
        ),
      },
      personalityRepo: {
        findByChatId: vi.fn().mockResolvedValue(existingPersonality),
        upsert: personalityUpsert,
      },
    });

    await pass.run(1);

    expect(personalityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        identityNotes: ['curious'],
        values: ['honesty'],
        socialHabits: ['lurks'],
        recurringThemes: ['freedom'],
      })
    );
  });

  it('does not clobber social profile runtime fields (affinityScore, labels)', async () => {
    const liveEvent = mkEvent(3);
    const socialUpsert = vi.fn().mockResolvedValue(undefined);
    const existingProfile = {
      userId: 10,
      chatId: 1,
      username: 'alice',
      affinityScore: 2,
      labels: [{ text: 'funny', evidenceMessageIds: [], status: 'active' }],
      patterns: [],
      grudges: [],
      trustLevel: 'medium' as const,
      preferredDistance: 'warm' as const,
      communicationStyle: 'old style',
      conflictStyle: 'old conflict',
      preferredTone: 'old tone',
      interests: ['old interest'],
      updatedAt: now,
    };

    const pass = makePass({
      events: { findByChatIdAfter: vi.fn().mockResolvedValue([liveEvent]) },
      ai: {
        proposeStateEvolution: vi.fn().mockResolvedValue(
          makeResult({
            userSnapshots: [
              {
                userId: 10,
                communicationStyle: 'new style',
                conflictStyle: 'new conflict',
                preferredTone: 'new tone',
                interests: ['new interest'],
              },
            ],
          })
        ),
      },
      socialProfileRepo: {
        findByChatAndUser: vi.fn().mockResolvedValue(existingProfile),
        upsert: socialUpsert,
        findByChat: vi.fn().mockResolvedValue([]),
      },
    });

    await pass.run(1);

    const upserted = socialUpsert.mock.calls[0][0];
    expect(upserted.affinityScore).toBe(2);
    expect(upserted.labels).toHaveLength(1);
    expect(upserted.communicationStyle).toBe('new style');
    expect(upserted.conflictStyle).toBe('new conflict');
    expect(upserted.preferredTone).toBe('new tone');
    expect(upserted.interests).toEqual(['new interest']);
  });

  it('returns error when AI call throws, keeps cursor lastEventId', async () => {
    const liveEvent = mkEvent(3);
    const cursorUpsert = vi.fn().mockResolvedValue(undefined);
    const errorLog = vi.fn().mockResolvedValue(999);

    const pass = makePass({
      events: { findByChatIdAfter: vi.fn().mockResolvedValue([liveEvent]) },
      cursor: {
        get: vi.fn().mockResolvedValue({
          chatId: 1,
          lastEventId: 1,
          lastRunAt: null,
        }),
        upsert: cursorUpsert,
      },
      ai: {
        proposeStateEvolution: vi
          .fn()
          .mockRejectedValue(new Error('openai down')),
      },
      errorLogger: { log: errorLog },
    });

    const result = await pass.run(1);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.errorEventId).toBe(999);
    }
    expect(cursorUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ lastEventId: 1 })
    );
    expect(errorLog).toHaveBeenCalled();
  });

  it('filters out stateEvolution slot events from live events for AI', async () => {
    const liveEvent = mkEvent(3, 'behaviorDecision');
    const evolutionEvent = mkEvent(4, 'stateEvolution');
    const assemblerAssemble = vi.fn().mockResolvedValue(baseContext);

    const pass = makePass({
      events: {
        findByChatIdAfter: vi
          .fn()
          .mockResolvedValue([liveEvent, evolutionEvent]),
      },
      assembler: { assemble: assemblerAssemble },
    });

    await pass.run(1);

    expect(assemblerAssemble).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [liveEvent],
      })
    );
  });
});
