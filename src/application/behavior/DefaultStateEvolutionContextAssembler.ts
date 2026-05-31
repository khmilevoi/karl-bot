import { inject, injectable } from 'inversify';

import {
  MESSAGE_SERVICE_ID,
  type MessageService,
} from '@/application/interfaces/messages/MessageService';
import {
  SUMMARY_SERVICE_ID,
  type SummaryService,
} from '@/application/interfaces/summaries/SummaryService';
import type {
  BotPersonalityState,
  BotPoliticalState,
} from '@/domain/behavior/schemas/state';
import {
  maxRisk,
  type StateImpactRisk,
} from '@/domain/behavior/schemas/primitives';
import type { BehaviorEventEntity } from '@/domain/entities/BehaviorEventEntity';
import {
  PERSONALITY_SIGNAL_REPOSITORY_ID,
  type PersonalitySignalRepository,
} from '@/domain/repositories/PersonalitySignalRepository';
import {
  PERSONALITY_STATE_REPOSITORY_ID,
  type PersonalityStateRepository,
} from '@/domain/repositories/PersonalityStateRepository';
import {
  POLITICAL_STATE_REPOSITORY_ID,
  type PoliticalStateRepository,
} from '@/domain/repositories/PoliticalStateRepository';
import {
  TRUTH_REPOSITORY_ID,
  type TruthRepository,
} from '@/domain/repositories/TruthRepository';
import {
  USER_POLITICAL_PROFILE_REPOSITORY_ID,
  type UserPoliticalProfileRepository,
} from '@/domain/repositories/UserPoliticalProfileRepository';
import {
  USER_SOCIAL_PROFILE_REPOSITORY_ID,
  type UserSocialProfileRepository,
} from '@/domain/repositories/UserSocialProfileRepository';

import {
  STATE_EVOLUTION_CONFIG_ID,
  type StateEvolutionConfig,
} from './BehaviorConfig';
import type {
  StateEvolutionContext,
  StoredBehaviorMessage,
} from './BehaviorTypes';
import type { StateEvolutionContextAssembler } from './StateEvolutionContextAssembler';

function defaultPersonality(chatId: number, now: string): BotPersonalityState {
  return {
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
  };
}

function defaultPolitical(chatId: number, now: string): BotPoliticalState {
  return {
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
  };
}

@injectable()
export class DefaultStateEvolutionContextAssembler implements StateEvolutionContextAssembler {
  constructor(
    @inject(STATE_EVOLUTION_CONFIG_ID)
    private readonly config: StateEvolutionConfig,
    @inject(MESSAGE_SERVICE_ID) private readonly messages: MessageService,
    @inject(SUMMARY_SERVICE_ID) private readonly summaries: SummaryService,
    @inject(PERSONALITY_STATE_REPOSITORY_ID)
    private readonly personalityRepo: PersonalityStateRepository,
    @inject(POLITICAL_STATE_REPOSITORY_ID)
    private readonly politicalRepo: PoliticalStateRepository,
    @inject(USER_SOCIAL_PROFILE_REPOSITORY_ID)
    private readonly profileRepo: UserSocialProfileRepository,
    @inject(USER_POLITICAL_PROFILE_REPOSITORY_ID)
    private readonly userPoliticalRepo: UserPoliticalProfileRepository,
    @inject(TRUTH_REPOSITORY_ID) private readonly truthRepo: TruthRepository,
    @inject(PERSONALITY_SIGNAL_REPOSITORY_ID)
    private readonly personalitySignalRepo: PersonalitySignalRepository
  ) {}

  async assemble(params: {
    chatId: number;
    events: readonly BehaviorEventEntity[];
  }): Promise<StateEvolutionContext> {
    const { chatId, events } = params;

    const selectedIds = this.extractSelectedIds(events);
    const now = new Date().toISOString();

    const [
      recent,
      selected,
      summary,
      personality,
      political,
      profiles,
      userPolitical,
      truths,
      personalitySignals,
    ] = await Promise.all([
      this.messages.getLastMessages(chatId, this.config.recentMessageLimit),
      selectedIds.length > 0
        ? this.messages.getMessagesByIds(selectedIds)
        : Promise.resolve([]),
      this.summaries.getSummary(chatId),
      this.personalityRepo.findByChatId(chatId),
      this.politicalRepo.findByChatId(chatId),
      this.profileRepo.findByChat(chatId),
      this.userPoliticalRepo.findByChat(chatId),
      this.truthRepo.findByChatId(chatId),
      this.personalitySignalRepo.findByChatId(chatId),
    ]);

    const mergedById = new Map<number, StoredBehaviorMessage>();
    for (const m of [...recent, ...selected]) {
      if (m.id != null && m.chatId != null) {
        mergedById.set(m.id, m as StoredBehaviorMessage);
      }
    }
    const mergedMessages = [...mergedById.values()].sort((a, b) => a.id - b.id);

    return {
      chatId,
      maxStateImpactRisk: maxRisk(
        events.map((e) => e.gateStateImpactRisk as StateImpactRisk | null)
      ),
      personalitySignals,
      summary,
      messages: mergedMessages,
      triggerMessageIds: [],
      contextMessageIds: [],
      batchMessageIds: [],
      state: {
        personality: personality ?? defaultPersonality(chatId, now),
        political: political ?? defaultPolitical(chatId, now),
        profiles,
        truths,
        userPolitical,
      },
    };
  }

  private extractSelectedIds(events: readonly BehaviorEventEntity[]): number[] {
    const ids = new Set<number>();
    for (const e of events) {
      for (const id of this.parseIds(e.triggerMessageIdsJson)) {
        ids.add(id);
      }
      for (const id of this.parseIds(e.contextMessageIdsJson)) {
        ids.add(id);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }

  private parseIds(json: string): number[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  }
}
