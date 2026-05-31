import { describe, expect, it, vi } from 'vitest';

import { DefaultStatePatchApplicator } from '../src/application/behavior/DefaultStatePatchApplicator';
import type { BehaviorRateLimiter } from '../src/application/behavior/BehaviorRateLimiter';
import type { PatchPolicy } from '../src/application/behavior/PatchPolicy';
import { DEFAULT_STATE_PATCH_APPLICATOR_CONFIG } from '../src/application/behavior/StatePatchApplicator';
import type { EvolutionPatch } from '../src/domain/behavior/schemas/patches';
import type {
  BotPoliticalState,
  UserPoliticalProfile,
} from '../src/domain/behavior/schemas/state';
import type { PersonalitySignalRepository } from '../src/domain/repositories/PersonalitySignalRepository';
import type { PoliticalStateRepository } from '../src/domain/repositories/PoliticalStateRepository';
import type { TruthRepository } from '../src/domain/repositories/TruthRepository';
import type { UserPoliticalProfileRepository } from '../src/domain/repositories/UserPoliticalProfileRepository';
import type { UserSocialProfileRepository } from '../src/domain/repositories/UserSocialProfileRepository';

const now = '2026-05-31T00:00:00.000Z';

const neutralCompass = {
  economic: 0,
  social: 0,
  economicConfidence: 0,
  socialConfidence: 0,
};

const ev = (confidence: number, ids: number[] = [1]) => ({
  messageIds: ids,
  summary: 'test',
  confidence,
});

function makeDefaultPolitical(chatId = 1): BotPoliticalState {
  return {
    chatId,
    ideologySummary: '',
    compass: neutralCompass,
    positions: [],
    uncertaintyAreas: [],
    influenceHistory: [],
    lastUpdatedAt: now,
  };
}

function makeDefaultUserPolitical(
  chatId = 1,
  userId = 10
): UserPoliticalProfile {
  return {
    chatId,
    userId,
    notes: [],
    compass: neutralCompass,
    updatedAt: now,
  };
}

function makeApplicator(overrides?: {
  signalRepo?: Partial<PersonalitySignalRepository>;
  politicalRepo?: Partial<PoliticalStateRepository>;
  userPoliticalRepo?: Partial<UserPoliticalProfileRepository>;
  policy?: Partial<PatchPolicy>;
}) {
  const signalRepo: PersonalitySignalRepository = {
    add: vi.fn().mockResolvedValue(1),
    findByChatId: vi.fn().mockResolvedValue([]),
    ...overrides?.signalRepo,
  };
  const politicalRepo: PoliticalStateRepository = {
    findByChatId: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...overrides?.politicalRepo,
  };
  const userPoliticalRepo: UserPoliticalProfileRepository = {
    findByChatAndUser: vi.fn().mockResolvedValue(undefined),
    findByChat: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
    ...overrides?.userPoliticalRepo,
  };
  const profileRepo: UserSocialProfileRepository = {
    findByChatAndUser: vi.fn().mockResolvedValue(undefined),
    findByChat: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
  };
  const truthRepo: TruthRepository = {
    findByChatId: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(1),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const policy: PatchPolicy = {
    evaluate: vi.fn().mockReturnValue({ outcome: 'accept', reason: 'ok' }),
    ...overrides?.policy,
  };
  const limiter: BehaviorRateLimiter = {
    checkPatch: vi.fn().mockReturnValue({ allowed: true }),
  };

  return new DefaultStatePatchApplicator(
    DEFAULT_STATE_PATCH_APPLICATOR_CONFIG,
    profileRepo,
    truthRepo,
    policy,
    limiter,
    signalRepo,
    politicalRepo,
    userPoliticalRepo
  );
}

describe('applyEvolutionPatches — personality.add_signal', () => {
  it('inserts a signal and returns applied when policy accepts', async () => {
    const signalRepo = { add: vi.fn().mockResolvedValue(1) };
    const applicator = makeApplicator({ signalRepo });
    const patches: EvolutionPatch[] = [
      {
        type: 'personality.add_signal',
        area: 'identity',
        polarity: 'reinforce',
        text: 'curious',
        evidence: ev(0.8),
      },
    ];
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches,
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('applied');
    expect(results[0].stateRef).toMatchObject({
      kind: 'bot_personality_signal',
      chatId: 1,
    });
    expect(signalRepo.add).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'curious', status: 'active', chatId: 1 })
    );
  });

  it('returns rejected when policy rejects', async () => {
    const applicator = makeApplicator({
      policy: {
        evaluate: vi
          .fn()
          .mockReturnValue({ outcome: 'reject', reason: 'low confidence' }),
      },
    });
    const patches: EvolutionPatch[] = [
      {
        type: 'personality.add_signal',
        area: 'values',
        polarity: 'contest',
        text: 'maybe bad',
        evidence: ev(0.1),
      },
    ];
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches,
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('rejected');
  });
});

describe('applyEvolutionPatches — politics.add_uncertainty', () => {
  it('appends uncertainty area and returns applied', async () => {
    const political = makeDefaultPolitical();
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ politicalRepo });
    const patches: EvolutionPatch[] = [
      {
        type: 'politics.add_uncertainty',
        topic: 'taxation',
        summary: 'ambiguous view',
        evidence: ev(0.5),
      },
    ];
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches,
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('applied');
    expect(politicalRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        uncertaintyAreas: expect.arrayContaining(['taxation: ambiguous view']),
      })
    );
  });

  it('does not duplicate uncertainty areas', async () => {
    const political = makeDefaultPolitical();
    political.uncertaintyAreas = ['taxation: ambiguous view'];
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ politicalRepo });
    await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'politics.add_uncertainty',
          topic: 'taxation',
          summary: 'ambiguous view',
          evidence: ev(0.5),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    // upsert is not called because nothing changed
    expect(politicalRepo.upsert).not.toHaveBeenCalled();
  });
});

describe('applyEvolutionPatches — politics.add_position', () => {
  it('adds a position and influence entry when accepted', async () => {
    const political = makeDefaultPolitical();
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ politicalRepo });
    const patches: EvolutionPatch[] = [
      {
        type: 'politics.add_position',
        topic: 'free trade',
        stance: 'supports',
        requestedIntensity: 'moderate',
        evidence: ev(0.75),
      },
    ];
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches,
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('applied');
    const upsertArg = (politicalRepo.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as BotPoliticalState;
    expect(upsertArg.positions).toHaveLength(1);
    expect(upsertArg.positions[0].topic).toBe('free trade');
    expect(upsertArg.positions[0].intensity).toBe('moderate');
    expect(upsertArg.influenceHistory).toHaveLength(1);
  });

  it('routes to uncertainty when policy returns to_uncertainty', async () => {
    const political = makeDefaultPolitical();
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({
      politicalRepo,
      policy: {
        evaluate: vi.fn().mockReturnValue({
          outcome: 'to_uncertainty',
          reason: 'weak claim',
        }),
      },
    });
    const patches: EvolutionPatch[] = [
      {
        type: 'politics.add_position',
        topic: 'tax',
        stance: 'maybe lower',
        requestedIntensity: 'weak',
        evidence: ev(0.3),
      },
    ];
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches,
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('to_uncertainty');
    const upsertArg = (politicalRepo.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as BotPoliticalState;
    expect(upsertArg.uncertaintyAreas).toContain('tax: maybe lower');
    expect(upsertArg.positions).toHaveLength(0);
  });

  it('escalates radical position when not reviewed by strong model', async () => {
    const political = makeDefaultPolitical();
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({
      politicalRepo,
      policy: {
        evaluate: vi.fn().mockReturnValue({
          outcome: 'escalate',
          reason: 'radical requires strong model',
        }),
      },
    });
    const patches: EvolutionPatch[] = [
      {
        type: 'politics.add_position',
        topic: 'state power',
        stance: 'extreme control',
        requestedIntensity: 'radical',
        evidence: ev(0.9),
      },
    ];
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches,
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('escalated');
    expect(politicalRepo.upsert).not.toHaveBeenCalled();
  });

  it('applies radical position when reviewed by strong model', async () => {
    const political = makeDefaultPolitical();
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({
      politicalRepo,
      policy: {
        evaluate: vi
          .fn()
          .mockReturnValue({ outcome: 'escalate', reason: 'radical' }),
      },
    });
    const patches: EvolutionPatch[] = [
      {
        type: 'politics.add_position',
        topic: 'state power',
        stance: 'extreme control',
        requestedIntensity: 'radical',
        evidence: ev(0.9),
      },
    ];
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches,
      reviewedByStrongModel: true,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('applied');
    expect(politicalRepo.upsert).toHaveBeenCalled();
  });

  it('assigns sequential position ids', async () => {
    const political = makeDefaultPolitical();
    political.positions = [
      {
        id: 3,
        topic: 'old',
        stance: 'x',
        intensity: 'weak',
        confidence: 0.5,
        status: 'active',
        evidenceMessageIds: [],
        opposingEvidenceMessageIds: [],
        origin: 'chat_discussion',
        updatedAt: now,
      },
    ];
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ politicalRepo });
    await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'politics.add_position',
          topic: 'new',
          stance: 'y',
          requestedIntensity: 'weak',
          evidence: ev(0.6),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    const upserted = (politicalRepo.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as BotPoliticalState;
    expect(upserted.positions[1].id).toBe(4);
  });
});

describe('applyEvolutionPatches — politics.adjust_position', () => {
  function makePositionedPolitical(): BotPoliticalState {
    const state = makeDefaultPolitical();
    state.positions = [
      {
        id: 1,
        topic: 'trade',
        stance: 'free',
        intensity: 'moderate',
        confidence: 0.7,
        status: 'active',
        evidenceMessageIds: [5],
        opposingEvidenceMessageIds: [],
        origin: 'chat_discussion',
        updatedAt: now,
      },
    ];
    return state;
  }

  it('contests a position (active → contested)', async () => {
    const political = makePositionedPolitical();
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ politicalRepo });
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'politics.adjust_position',
          positionId: 1,
          direction: 'contest',
          evidence: ev(0.8, [9]),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('applied');
    const upserted = (politicalRepo.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as BotPoliticalState;
    expect(upserted.positions[0].status).toBe('contested');
    expect(upserted.positions[0].opposingEvidenceMessageIds).toContain(9);
  });

  it('reverses a position', async () => {
    const political = makePositionedPolitical();
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ politicalRepo });
    await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'politics.adjust_position',
          positionId: 1,
          direction: 'reverse',
          evidence: ev(0.9, [10]),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    const upserted = (politicalRepo.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as BotPoliticalState;
    expect(upserted.positions[0].status).toBe('reversed');
  });

  it('returns target_not_found for missing position id', async () => {
    const political = makePositionedPolitical();
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ politicalRepo });
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'politics.adjust_position',
          positionId: 999,
          direction: 'soften',
          evidence: ev(0.5),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('rejected');
    expect(results[0].reason).toBe('target_not_found');
  });

  it('escalates radical adjust when not reviewed', async () => {
    const political = makePositionedPolitical();
    political.positions[0].intensity = 'strong';
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ politicalRepo });
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'politics.adjust_position',
          positionId: 1,
          direction: 'radicalize',
          evidence: ev(0.9),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('escalated');
    expect(politicalRepo.upsert).not.toHaveBeenCalled();
  });
});

describe('applyEvolutionPatches — user.add_political_note', () => {
  it('appends a note to the user political profile', async () => {
    const userPoliticalRepo = {
      findByChatAndUser: vi.fn().mockResolvedValue(makeDefaultUserPolitical()),
      findByChat: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ userPoliticalRepo });
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'user.add_political_note',
          userId: 10,
          text: 'skeptical of state control',
          evidence: ev(0.7),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('applied');
    expect(results[0].stateRef).toMatchObject({
      kind: 'user_political_profile',
      chatId: 1,
      userId: 10,
    });
    const upserted = (userPoliticalRepo.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as UserPoliticalProfile;
    expect(upserted.notes).toHaveLength(1);
    expect(upserted.notes[0].text).toBe('skeptical of state control');
    expect(upserted.notes[0].status).toBe('active');
  });

  it('creates a default profile when none exists', async () => {
    const userPoliticalRepo = {
      findByChatAndUser: vi.fn().mockResolvedValue(undefined),
      findByChat: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ userPoliticalRepo });
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'user.add_political_note',
          userId: 99,
          text: 'first note',
          evidence: ev(0.6),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('applied');
    const upserted = (userPoliticalRepo.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as UserPoliticalProfile;
    expect(upserted.userId).toBe(99);
    expect(upserted.notes).toHaveLength(1);
  });
});

describe('applyEvolutionPatches — user.contest_political_note', () => {
  it('flips active note to contested', async () => {
    const profile = makeDefaultUserPolitical();
    profile.notes = [
      {
        text: 'supports free trade',
        evidenceMessageIds: [1],
        status: 'active',
      },
    ];
    const userPoliticalRepo = {
      findByChatAndUser: vi.fn().mockResolvedValue(profile),
      findByChat: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ userPoliticalRepo });
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'user.contest_political_note',
          userId: 10,
          target: { text: 'supports free trade' },
          evidence: ev(0.8, [2]),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('applied');
    const upserted = (userPoliticalRepo.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as UserPoliticalProfile;
    expect(upserted.notes[0].status).toBe('contested');
    expect(upserted.notes[0].evidenceMessageIds).toContain(2);
  });

  it('flips contested note to inactive', async () => {
    const profile = makeDefaultUserPolitical();
    profile.notes = [
      {
        text: 'supports free trade',
        evidenceMessageIds: [1],
        status: 'contested',
      },
    ];
    const userPoliticalRepo = {
      findByChatAndUser: vi.fn().mockResolvedValue(profile),
      findByChat: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ userPoliticalRepo });
    await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'user.contest_political_note',
          userId: 10,
          target: { text: 'supports free trade' },
          evidence: ev(0.8),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    const upserted = (userPoliticalRepo.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as UserPoliticalProfile;
    expect(upserted.notes[0].status).toBe('inactive');
  });

  it('returns target_not_found when no matching active note', async () => {
    const userPoliticalRepo = {
      findByChatAndUser: vi.fn().mockResolvedValue(makeDefaultUserPolitical()),
      findByChat: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const applicator = makeApplicator({ userPoliticalRepo });
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'user.contest_political_note',
          userId: 10,
          target: { text: 'nonexistent note' },
          evidence: ev(0.8),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('rejected');
    expect(results[0].reason).toBe('target_not_found');
  });
});

describe('applyEvolutionPatches — best-effort independence', () => {
  it('a rejected patch does not block a subsequent applied patch', async () => {
    const political = makeDefaultPolitical();
    const politicalRepo = {
      findByChatId: vi.fn().mockResolvedValue(political),
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    let callCount = 0;
    const applicator = makeApplicator({
      politicalRepo,
      policy: {
        evaluate: vi.fn().mockImplementation(() => {
          callCount += 1;
          return callCount === 1
            ? { outcome: 'reject', reason: 'first rejected' }
            : { outcome: 'accept', reason: 'ok' };
        }),
      },
    });
    const results = await applicator.applyEvolutionPatches({
      chatId: 1,
      patches: [
        {
          type: 'politics.add_uncertainty',
          topic: 'rejected',
          summary: 'bad',
          evidence: ev(0.1),
        },
        {
          type: 'politics.add_uncertainty',
          topic: 'accepted',
          summary: 'good',
          evidence: ev(0.8),
        },
      ],
      reviewedByStrongModel: false,
      nowIso: now,
    });
    expect(results[0].outcome).toBe('rejected');
    expect(results[1].outcome).toBe('applied');
  });
});
