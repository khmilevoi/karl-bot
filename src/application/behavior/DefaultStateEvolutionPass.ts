import { inject, injectable } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import type {
  PersonalitySnapshot,
  UserCompassSnapshot,
  UserProfileSnapshot,
} from '@/domain/behavior/schemas/evolution';
import type { PoliticalCompass } from '@/domain/behavior/schemas/state';
import {
  PERSONALITY_STATE_REPOSITORY_ID,
  type PersonalityStateRepository,
} from '@/domain/repositories/PersonalityStateRepository';
import {
  POLITICAL_STATE_REPOSITORY_ID,
  type PoliticalStateRepository,
} from '@/domain/repositories/PoliticalStateRepository';
import {
  USER_POLITICAL_PROFILE_REPOSITORY_ID,
  type UserPoliticalProfileRepository,
} from '@/domain/repositories/UserPoliticalProfileRepository';
import {
  USER_SOCIAL_PROFILE_REPOSITORY_ID,
  type UserSocialProfileRepository,
} from '@/domain/repositories/UserSocialProfileRepository';

import { AI_ERROR_LOGGER_ID, type AiErrorLogger } from './AiErrorLogger';
import {
  BEHAVIOR_AI_SERVICE_ID,
  type BehaviorAiService,
} from './BehaviorAiService';
import {
  BEHAVIOR_EVENT_LOGGER_ID,
  type BehaviorEventLogger,
} from './BehaviorEventLogger';
import {
  STATE_EVOLUTION_CONTEXT_ASSEMBLER_ID,
  type StateEvolutionContextAssembler,
} from './StateEvolutionContextAssembler';
import {
  STATE_EVOLUTION_CURSOR_REPOSITORY_ID,
  type StateEvolutionCursorRepository,
} from '@/domain/repositories/StateEvolutionCursorRepository';
import {
  BEHAVIOR_EVENT_REPOSITORY_ID,
  type BehaviorEventRepository,
} from '@/domain/repositories/BehaviorEventRepository';
import {
  STATE_PATCH_APPLICATOR_ID,
  type StatePatchApplicator,
} from './StatePatchApplicator';
import type {
  StateEvolutionPass,
  StateEvolutionRunResult,
} from './StateEvolutionPass';

function clampAxis(v: number): number {
  return Math.max(-10, Math.min(10, v));
}

function clampConfidence(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clampCompass(c: PoliticalCompass): PoliticalCompass {
  return {
    economic: clampAxis(c.economic),
    social: clampAxis(c.social),
    economicConfidence: clampConfidence(c.economicConfidence),
    socialConfidence: clampConfidence(c.socialConfidence),
  };
}

@injectable()
export class DefaultStateEvolutionPass implements StateEvolutionPass {
  private readonly logger: Logger;

  constructor(
    @inject(STATE_EVOLUTION_CURSOR_REPOSITORY_ID)
    private readonly cursorRepo: StateEvolutionCursorRepository,
    @inject(BEHAVIOR_EVENT_REPOSITORY_ID)
    private readonly eventRepo: BehaviorEventRepository,
    @inject(STATE_EVOLUTION_CONTEXT_ASSEMBLER_ID)
    private readonly assembler: StateEvolutionContextAssembler,
    @inject(BEHAVIOR_AI_SERVICE_ID)
    private readonly ai: BehaviorAiService,
    @inject(STATE_PATCH_APPLICATOR_ID)
    private readonly applicator: StatePatchApplicator,
    @inject(PERSONALITY_STATE_REPOSITORY_ID)
    private readonly personalityRepo: PersonalityStateRepository,
    @inject(POLITICAL_STATE_REPOSITORY_ID)
    private readonly politicalRepo: PoliticalStateRepository,
    @inject(USER_SOCIAL_PROFILE_REPOSITORY_ID)
    private readonly socialProfileRepo: UserSocialProfileRepository,
    @inject(USER_POLITICAL_PROFILE_REPOSITORY_ID)
    private readonly userPoliticalRepo: UserPoliticalProfileRepository,
    @inject(BEHAVIOR_EVENT_LOGGER_ID)
    private readonly eventLogger: BehaviorEventLogger,
    @inject(AI_ERROR_LOGGER_ID)
    private readonly errorLogger: AiErrorLogger,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('StateEvolutionPass');
  }

  async run(chatId: number): Promise<StateEvolutionRunResult> {
    this.logger.info({ chatId }, 'State evolution run started');
    const cursor = (await this.cursorRepo.get(chatId)) ?? {
      chatId,
      lastEventId: 0,
      lastRunAt: null,
    };

    const allNew = await this.eventRepo.findByChatIdAfter(
      chatId,
      cursor.lastEventId
    );
    const liveNew = allNew.filter((e) => e.modelSlot !== 'stateEvolution');
    const maxReadEventId = allNew.reduce(
      (m, e) => Math.max(m, e.id),
      cursor.lastEventId
    );
    const nowIso = new Date().toISOString();

    if (liveNew.length === 0) {
      this.logger.info({ chatId }, 'No new events — skipping');
      await this.cursorRepo.upsert({
        chatId,
        lastEventId: maxReadEventId,
        lastRunAt: nowIso,
      });
      return { kind: 'skipped' };
    }

    this.logger.info(
      { chatId, eventCount: liveNew.length },
      'New events found — calling AI'
    );

    let context;
    let result;

    try {
      context = await this.assembler.assemble({ chatId, events: liveNew });
      result = await this.ai.proposeStateEvolution(context);
    } catch (error) {
      this.logger.error({ error, chatId }, 'State evolution AI call failed');
      const errorEventId = await this.errorLogger.log({
        chatId,
        source: 'state_evolution_openai',
        severity: 'error',
        errorCode: 'AI_CALL_FAILED',
        message: error instanceof Error ? error.message : 'unknown error',
        component: 'DefaultStateEvolutionPass',
        operation: 'proposeStateEvolution',
        fixHint: 'retry after cooldown',
      });
      await this.cursorRepo.upsert({
        chatId,
        lastEventId: cursor.lastEventId,
        lastRunAt: nowIso,
      });
      return { kind: 'error', errorEventId };
    }

    this.logger.info(
      { chatId, escalated: result.metadata.escalated },
      'AI responded — applying patches'
    );
    const reviewedByStrongModel = result.metadata.escalated;
    const patchResults = await this.applicator.applyEvolutionPatches({
      chatId,
      patches: result.decision.evolutionPatches,
      reviewedByStrongModel,
      nowIso,
    });

    await this.writePersonalitySnapshot(
      chatId,
      result.decision.personalitySnapshot,
      nowIso
    );
    await this.writeBotCompass(chatId, result.decision.botCompass, nowIso);
    await this.writeUserSnapshots(
      chatId,
      result.decision.userSnapshots,
      nowIso
    );
    await this.writeUserCompasses(
      chatId,
      result.decision.userPoliticalSnapshots,
      nowIso
    );

    const behaviorEventId = await this.eventLogger.logEvolution({
      chatId,
      result,
      patchResults,
      maxStateImpactRisk: context.maxStateImpactRisk,
    });

    await this.cursorRepo.upsert({
      chatId,
      lastEventId: Math.max(maxReadEventId, behaviorEventId),
      lastRunAt: nowIso,
    });

    this.logger.info(
      { chatId, behaviorEventId, patchCount: patchResults.length },
      'State evolution completed'
    );
    return { kind: 'evolved', behaviorEventId, patchResults };
  }

  private async writePersonalitySnapshot(
    chatId: number,
    snapshot: PersonalitySnapshot,
    nowIso: string
  ): Promise<void> {
    const existing = await this.personalityRepo.findByChatId(chatId);
    const state = existing ?? {
      chatId,
      identityNotes: [],
      values: [],
      speechStyle: {
        tone: 'neutral',
        humor: 'none',
        verbosity: 'short' as const,
        formality: 'medium' as const,
      },
      socialHabits: [],
      recurringThemes: [],
      lastUpdatedAt: nowIso,
    };
    state.identityNotes = snapshot.identityNotes;
    state.values = snapshot.values;
    state.speechStyle = snapshot.speechStyle;
    state.socialHabits = snapshot.socialHabits;
    state.recurringThemes = snapshot.recurringThemes;
    state.lastUpdatedAt = nowIso;
    await this.personalityRepo.upsert(state);
  }

  private async writeBotCompass(
    chatId: number,
    botCompass: PoliticalCompass,
    nowIso: string
  ): Promise<void> {
    const existing = await this.politicalRepo.findByChatId(chatId);
    const state = existing ?? {
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
      lastUpdatedAt: nowIso,
    };
    state.compass = clampCompass(botCompass);
    state.lastUpdatedAt = nowIso;
    await this.politicalRepo.upsert(state);
  }

  private async writeUserSnapshots(
    chatId: number,
    snapshots: UserProfileSnapshot[],
    nowIso: string
  ): Promise<void> {
    for (const snap of snapshots) {
      const existing = await this.socialProfileRepo.findByChatAndUser(
        chatId,
        snap.userId
      );
      const profile = existing ?? {
        userId: snap.userId,
        chatId,
        username: null,
        affinityScore: 0,
        labels: [],
        patterns: [],
        grudges: [],
        trustLevel: 'none' as const,
        preferredDistance: 'neutral' as const,
        communicationStyle: '',
        conflictStyle: '',
        preferredTone: '',
        interests: [],
        updatedAt: nowIso,
      };
      profile.communicationStyle = snap.communicationStyle;
      profile.conflictStyle = snap.conflictStyle;
      profile.preferredTone = snap.preferredTone;
      profile.interests = snap.interests;
      profile.updatedAt = nowIso;
      await this.socialProfileRepo.upsert(profile);
    }
  }

  private async writeUserCompasses(
    chatId: number,
    snapshots: UserCompassSnapshot[],
    nowIso: string
  ): Promise<void> {
    for (const snap of snapshots) {
      const existing = await this.userPoliticalRepo.findByChatAndUser(
        chatId,
        snap.userId
      );
      const profile = existing ?? {
        chatId,
        userId: snap.userId,
        notes: [],
        compass: {
          economic: 0,
          social: 0,
          economicConfidence: 0,
          socialConfidence: 0,
        },
        updatedAt: nowIso,
      };
      profile.compass = clampCompass(snap.compass);
      profile.updatedAt = nowIso;
      await this.userPoliticalRepo.upsert(profile);
    }
  }
}
