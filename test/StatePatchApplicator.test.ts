import { describe, expect, it, vi } from 'vitest';

import { DefaultStatePatchApplicator } from '../src/application/behavior/DefaultStatePatchApplicator';
import type { BehaviorRateLimiter } from '../src/application/behavior/BehaviorRateLimiter';
import type { PatchPolicy } from '../src/application/behavior/PatchPolicy';
import type { StatePatchApplicatorConfig } from '../src/application/behavior/StatePatchApplicator';
import type { EmbeddingService } from '../src/application/interfaces/ai/EmbeddingService';
import type {
  LiveStatePatch,
  TruthPatch,
  UserProfilePatch,
} from '../src/domain/behavior/schemas/patches';
import type {
  BotTruth,
  UserSocialProfile,
} from '../src/domain/behavior/schemas/state';
import type { TruthRepository } from '../src/domain/repositories/TruthRepository';
import type { UserSocialProfileRepository } from '../src/domain/repositories/UserSocialProfileRepository';
import type { ChatMessage } from '../src/domain/messages/ChatMessage';

const config: StatePatchApplicatorConfig = {
  truthStableConfidence: 0.75,
  truthDuplicateSimilarity: 0.9,
};

const acceptingPolicy: PatchPolicy = {
  evaluate: vi.fn(() => ({ outcome: 'accept', reason: 'ok' })),
};

const allowingLimiter: BehaviorRateLimiter = {
  checkAction: vi.fn(() => ({ allowed: true })),
  checkPatch: vi.fn(() => ({ allowed: true })),
};

function evidence(ids: number[], confidence = 0.8) {
  return {
    messageIds: ids,
    summary: 'evidence',
    confidence,
  };
}

function makeProfile(overrides: Partial<UserSocialProfile>): UserSocialProfile {
  return {
    userId: 1,
    chatId: 1,
    username: null,
    affinityScore: 0,
    labels: [],
    patterns: [],
    grudges: [],
    trustLevel: 'low',
    preferredDistance: 'neutral',
    communicationStyle: '',
    conflictStyle: '',
    preferredTone: '',
    interests: [],
    updatedAt: 'old',
    ...overrides,
  };
}

function makeTruth(overrides: Partial<BotTruth>): BotTruth {
  return {
    id: 1,
    chatId: 1,
    text: 'old truth',
    sourceMessageIds: [1],
    confidence: 0.5,
    relatedTruthIds: [],
    contradictsTruthIds: [],
    status: 'fresh',
    createdAt: 'old',
    ...overrides,
  };
}

function makeRepos(params?: {
  profile?: UserSocialProfile;
  truths?: BotTruth[];
}) {
  const profiles = new Map<string, UserSocialProfile>();
  if (params?.profile) {
    profiles.set(
      `${params.profile.chatId}:${params.profile.userId}`,
      params.profile
    );
  }

  const truths = new Map<number, BotTruth>();
  for (const truth of params?.truths ?? []) {
    truths.set(truth.id, truth);
  }
  const embeddings = new Map<number, number[] | null>();
  for (const truth of params?.truths ?? []) {
    embeddings.set(truth.id, null);
  }
  let nextTruthId = Math.max(0, ...truths.keys()) + 1;

  const profileRepo: UserSocialProfileRepository = {
    findByChatAndUser: vi.fn((chatId: number, userId: number) =>
      Promise.resolve(profiles.get(`${chatId}:${userId}`))
    ),
    findByChat: vi.fn(),
    upsert: vi.fn((profile: UserSocialProfile) => {
      profiles.set(`${profile.chatId}:${profile.userId}`, profile);
      return Promise.resolve();
    }),
  };

  const truthRepo: TruthRepository = {
    add: vi.fn((truth, embedding?: number[] | null) => {
      const id = nextTruthId;
      nextTruthId += 1;
      truths.set(id, { id, ...truth });
      embeddings.set(id, embedding ?? null);
      return Promise.resolve(id);
    }),
    findById: vi.fn((id: number) => Promise.resolve(truths.get(id))),
    findByChatId: vi.fn((chatId: number) =>
      Promise.resolve([...truths.values()].filter((t) => t.chatId === chatId))
    ),
    update: vi.fn((truth: BotTruth) => {
      truths.set(truth.id, truth);
      return Promise.resolve();
    }),
    findActiveEmbeddings: vi.fn((chatId: number) =>
      Promise.resolve(
        [...truths.values()]
          .filter((t) => t.chatId === chatId && t.status !== 'superseded')
          .map((t) => ({
            id: t.id,
            text: t.text,
            embedding: embeddings.get(t.id) ?? null,
          }))
      )
    ),
    setEmbedding: vi.fn((id: number, embedding: number[]) => {
      embeddings.set(id, embedding);
      return Promise.resolve();
    }),
  };

  return { profileRepo, profiles, truthRepo, truths, embeddings };
}

// Deterministic, collision-free fake: each distinct unmapped text gets a fresh
// one-hot dimension, so different texts are orthogonal (cosine 0) and the same
// text is identical (cosine 1). Texts present in `map` use the explicit vector.
function makeEmbeddings(map: Record<string, number[]> = {}): EmbeddingService {
  const assigned = new Map<string, number[]>();
  let nextDim = 0;
  const vectorFor = (text: string): number[] => {
    if (map[text]) {
      return map[text];
    }
    const existing = assigned.get(text);
    if (existing) {
      return existing;
    }
    const vector = new Array<number>(256).fill(0);
    vector[nextDim] = 1;
    nextDim += 1;
    assigned.set(text, vector);
    return vector;
  };
  return {
    embed: vi.fn((texts: readonly string[]) =>
      Promise.resolve(texts.map(vectorFor))
    ),
  };
}

function makeApplicator(params?: {
  profileRepo?: UserSocialProfileRepository;
  truthRepo?: TruthRepository;
  policy?: PatchPolicy;
  limiter?: BehaviorRateLimiter;
  embeddings?: EmbeddingService;
}) {
  const repos = makeRepos();
  return new DefaultStatePatchApplicator(
    config,
    params?.profileRepo ?? repos.profileRepo,
    params?.truthRepo ?? repos.truthRepo,
    params?.policy ?? acceptingPolicy,
    params?.limiter ?? allowingLimiter,
    undefined as never,
    undefined as never,
    undefined as never,
    params?.embeddings ?? makeEmbeddings()
  );
}

describe('DefaultStatePatchApplicator', () => {
  it('creates profiles, updates username, sums affinity, appends signals, and recomputes runtime fields', async () => {
    const { profileRepo, profiles, truthRepo } = makeRepos();
    const applicator = makeApplicator({ profileRepo, truthRepo });
    const patches: UserProfilePatch[] = [
      {
        type: 'user.adjust_affinity',
        userId: 7,
        delta: 1,
        evidence: evidence([1]),
      },
      {
        type: 'user.adjust_affinity',
        userId: 7,
        delta: 1,
        evidence: evidence([2]),
      },
      {
        type: 'user.adjust_affinity',
        userId: 7,
        delta: 1,
        evidence: evidence([3]),
      },
      {
        type: 'user.adjust_affinity',
        userId: 7,
        delta: 1,
        evidence: evidence([4]),
      },
      {
        type: 'user.add_label',
        userId: 7,
        label: 'reliable',
        evidence: evidence([5]),
      },
      {
        type: 'user.add_pattern',
        userId: 7,
        polarity: 'negative',
        text: 'snaps in arguments',
        evidence: evidence([6]),
      },
      {
        type: 'user.add_grudge',
        userId: 7,
        text: 'kept poking Carl',
        evidence: evidence([7]),
      },
    ];
    const contextMessages: ChatMessage[] = [
      {
        id: 1,
        chatId: 1,
        userId: 7,
        username: 'old',
        role: 'user',
        content: 'a',
      },
      {
        id: 7,
        chatId: 1,
        userId: 7,
        username: 'alice',
        role: 'user',
        content: 'b',
      },
    ];

    const results = await applicator.applyPatches({
      chatId: 1,
      patches,
      contextMessages,
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results.every((result) => result.outcome === 'applied')).toBe(true);
    expect(profileRepo.upsert).toHaveBeenCalledTimes(1);
    const profile = profiles.get('1:7');
    expect(profile?.username).toBe('alice');
    expect(profile?.affinityScore).toBe(3);
    expect(profile?.labels[0]).toEqual({
      text: 'reliable',
      evidenceMessageIds: [5],
      status: 'active',
    });
    expect(profile?.patterns[0]?.polarity).toBe('negative');
    expect(profile?.grudges).toHaveLength(1);
    expect(profile?.trustLevel).toBe('low');
    expect(profile?.preferredDistance).toBe('avoidant');
  });

  it('contests profile signals active to contested to inactive without deleting them', async () => {
    const { profileRepo, profiles, truthRepo } = makeRepos({
      profile: makeProfile({
        labels: [
          { text: 'reliable', evidenceMessageIds: [1], status: 'active' },
        ],
      }),
    });
    const applicator = makeApplicator({ profileRepo, truthRepo });
    const patches: UserProfilePatch[] = [
      {
        type: 'user.contest_profile_signal',
        userId: 1,
        target: { kind: 'label', text: 'reliable' },
        evidence: evidence([2]),
      },
      {
        type: 'user.contest_profile_signal',
        userId: 1,
        target: { kind: 'label', text: 'reliable' },
        evidence: evidence([3]),
      },
    ];

    const results = await applicator.applyPatches({
      chatId: 1,
      patches,
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results.every((result) => result.outcome === 'applied')).toBe(true);
    expect(profiles.get('1:1')?.labels).toEqual([
      {
        text: 'reliable',
        evidenceMessageIds: [1, 2, 3],
        status: 'inactive',
      },
    ]);
  });

  it('applies truth add, reinforce, contest, and revise semantics', async () => {
    const existing = makeTruth({
      id: 10,
      confidence: 0.5,
      sourceMessageIds: [1],
    });
    const { profileRepo, truthRepo, truths } = makeRepos({
      truths: [existing],
    });
    const applicator = makeApplicator({ profileRepo, truthRepo });
    const patches: TruthPatch[] = [
      {
        type: 'truth.add',
        text: 'new stable truth',
        relatedTruthIds: [10, 10],
        contradictsTruthIds: [],
        evidence: evidence([2, 2], 0.9),
      },
      {
        type: 'truth.reinforce',
        truthId: 10,
        evidence: evidence([3], 0.5),
      },
      {
        type: 'truth.contest',
        truthId: 10,
        counterText: 'counter truth',
        evidence: evidence([4], 0.5),
      },
      {
        type: 'truth.revise',
        truthId: 10,
        revisedText: 'replacement truth',
        evidence: evidence([5], 0.9),
      },
    ];

    const results = await applicator.applyPatches({
      chatId: 1,
      patches,
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results.every((result) => result.outcome === 'applied')).toBe(true);
    const addedTruth = truths.get(11);
    expect(addedTruth).toMatchObject({
      text: 'new stable truth',
      sourceMessageIds: [2],
      relatedTruthIds: [10],
      confidence: 0.9,
      status: 'stable',
    });
    expect(truths.get(12)).toMatchObject({
      text: 'counter truth',
      contradictsTruthIds: [10],
    });
    expect(truths.get(13)).toMatchObject({
      text: 'replacement truth',
      relatedTruthIds: [10],
      confidence: 0.9,
      status: 'stable',
    });
    expect(truths.get(10)).toMatchObject({
      status: 'superseded',
      relatedTruthIds: [13],
      contradictsTruthIds: [12],
    });
  });

  it('rejects patches denied by policy without blocking unrelated patches', async () => {
    const { profileRepo, profiles, truthRepo } = makeRepos();
    const policy: PatchPolicy = {
      evaluate: vi.fn((patch: LiveStatePatch) =>
        patch.type === 'user.add_grudge'
          ? { outcome: 'reject', reason: 'policy denied' }
          : { outcome: 'accept', reason: 'ok' }
      ),
    };
    const applicator = makeApplicator({ profileRepo, truthRepo, policy });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'user.add_grudge',
          userId: 1,
          text: 'bad',
          evidence: evidence([1]),
        },
        {
          type: 'user.add_label',
          userId: 1,
          label: 'fine',
          evidence: evidence([2]),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results.map((result) => result.outcome)).toEqual([
      'rejected',
      'applied',
    ]);
    expect(profiles.get('1:1')?.labels).toHaveLength(1);
    expect(profiles.get('1:1')?.grudges).toHaveLength(0);
  });

  it('rate-limits truth.add without blocking non-creation truth patches', async () => {
    const { profileRepo, truthRepo } = makeRepos({
      truths: [makeTruth({ id: 1 })],
    });
    const limiter: BehaviorRateLimiter = {
      checkAction: vi.fn(() => ({ allowed: true })),
      checkPatch: vi.fn((params) =>
        params.patch.type === 'truth.add'
          ? { allowed: false, reason: 'truth-add rate limit exceeded' }
          : { allowed: true }
      ),
    };
    const applicator = makeApplicator({ profileRepo, truthRepo, limiter });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'too many truths',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([1]),
        },
        {
          type: 'truth.reinforce',
          truthId: 1,
          evidence: evidence([2]),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results.map((result) => result.outcome)).toEqual([
      'rate_limited',
      'applied',
    ]);
    expect(truthRepo.add).not.toHaveBeenCalled();
    expect(truthRepo.update).toHaveBeenCalledTimes(1);
  });

  it('merges a near-duplicate truth.add into the existing truth instead of inserting', async () => {
    const existing = makeTruth({
      id: 10,
      text: 'Carl is from the north of Russia.',
      confidence: 0.8,
      sourceMessageIds: [1],
      status: 'stable',
    });
    const { profileRepo, truthRepo, truths } = makeRepos({
      truths: [existing],
    });
    const shared = [1, 0, 0];
    const embeddings = makeEmbeddings({
      'Carl is from the north of Russia.': shared,
      'Carl is from Russia, specifically the north.': shared,
    });
    const applicator = makeApplicator({ profileRepo, truthRepo, embeddings });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl is from Russia, specifically the north.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([2], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results[0].outcome).toBe('merged');
    expect(results[0].stateRef).toMatchObject({
      kind: 'bot_truth',
      truthId: 10,
    });
    expect(truthRepo.add).not.toHaveBeenCalled();
    const merged = truths.get(10);
    expect(merged?.sourceMessageIds).toEqual([1, 2]);
    expect(merged?.confidence).toBeCloseTo(0.98);
    expect(merged?.status).toBe('stable');
    expect(truths.size).toBe(1);
  });

  it('inserts a new truth when no existing truth is similar enough', async () => {
    const existing = makeTruth({
      id: 10,
      text: 'Carl likes fixing radios.',
      status: 'stable',
    });
    const { profileRepo, truthRepo, truths } = makeRepos({
      truths: [existing],
    });
    const applicator = makeApplicator({ profileRepo, truthRepo });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl was promoted to OpenAI usage tier 2.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([3], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results[0].outcome).toBe('applied');
    expect(truthRepo.add).toHaveBeenCalledTimes(1);
    expect(truths.size).toBe(2);
  });

  it('does not merge into a truth the add explicitly contradicts', async () => {
    const existing = makeTruth({
      id: 10,
      text: 'Carl was born in Poland.',
      status: 'stable',
    });
    const { profileRepo, truthRepo, truths } = makeRepos({
      truths: [existing],
    });
    const shared = [1, 0, 0];
    const embeddings = makeEmbeddings({
      'Carl was born in Poland.': shared,
      'Carl was born in Russia, not Poland.': shared,
    });
    const applicator = makeApplicator({ profileRepo, truthRepo, embeddings });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl was born in Russia, not Poland.',
          relatedTruthIds: [],
          contradictsTruthIds: [10],
          evidence: evidence([4], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results[0].outcome).toBe('applied');
    expect(truthRepo.add).toHaveBeenCalledTimes(1);
    expect(truths.size).toBe(2);
  });

  it('falls open to a plain insert when the embedding service fails', async () => {
    const { profileRepo, truthRepo, truths } = makeRepos();
    const embeddings: EmbeddingService = {
      embed: vi.fn(() => Promise.reject(new Error('embeddings down'))),
    };
    const applicator = makeApplicator({ profileRepo, truthRepo, embeddings });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl owns a cat.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([5], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results[0].outcome).toBe('applied');
    expect(truthRepo.add).toHaveBeenCalledTimes(1);
    expect(truths.size).toBe(1);
  });

  it('dedups a second identical truth.add within the same batch', async () => {
    const { profileRepo, truthRepo, truths } = makeRepos();
    const shared = [1, 0, 0];
    const embeddings = makeEmbeddings({ 'Carl hates Mondays.': shared });
    const applicator = makeApplicator({ profileRepo, truthRepo, embeddings });

    const results = await applicator.applyPatches({
      chatId: 1,
      patches: [
        {
          type: 'truth.add',
          text: 'Carl hates Mondays.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([6], 0.9),
        },
        {
          type: 'truth.add',
          text: 'Carl hates Mondays.',
          relatedTruthIds: [],
          contradictsTruthIds: [],
          evidence: evidence([7], 0.9),
        },
      ],
      contextMessages: [],
      nowIso: 'now',
      nowMs: 1_000,
    });

    expect(results.map((r) => r.outcome)).toEqual(['applied', 'merged']);
    expect(truths.size).toBe(1);
    expect([...truths.values()][0].sourceMessageIds).toEqual([6, 7]);
  });
});
