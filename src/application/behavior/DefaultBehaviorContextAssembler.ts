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
  USER_SOCIAL_PROFILE_REPOSITORY_ID,
  type UserSocialProfileRepository,
} from '@/domain/repositories/UserSocialProfileRepository';

import {
  BEHAVIOR_PIPELINE_CONFIG_ID,
  type BehaviorPipelineConfig,
} from './BehaviorConfig';
import type {
  BehaviorContextAssembler,
  BehaviorContextAssemblerInput,
} from './BehaviorContextAssembler';
import type {
  BehaviorDecisionContext,
  StoredBehaviorMessage,
} from './BehaviorTypes';

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
    positions: [],
    uncertaintyAreas: [],
    influenceHistory: [],
    lastUpdatedAt: now,
  };
}

@injectable()
export class DefaultBehaviorContextAssembler implements BehaviorContextAssembler {
  constructor(
    @inject(BEHAVIOR_PIPELINE_CONFIG_ID)
    private readonly config: BehaviorPipelineConfig,
    @inject(MESSAGE_SERVICE_ID) private readonly messages: MessageService,
    @inject(SUMMARY_SERVICE_ID) private readonly summaries: SummaryService,
    @inject(PERSONALITY_STATE_REPOSITORY_ID)
    private readonly personalityRepo: PersonalityStateRepository,
    @inject(POLITICAL_STATE_REPOSITORY_ID)
    private readonly politicalRepo: PoliticalStateRepository,
    @inject(USER_SOCIAL_PROFILE_REPOSITORY_ID)
    private readonly profileRepo: UserSocialProfileRepository,
    @inject(TRUTH_REPOSITORY_ID) private readonly truthRepo: TruthRepository
  ) {}

  async assemble(
    input: BehaviorContextAssemblerInput
  ): Promise<BehaviorDecisionContext> {
    const { chatId, triggerMessageIds, contextMessageIds, gate } = input;

    const selectedIds = [
      ...new Set([...triggerMessageIds, ...contextMessageIds]),
    ];

    const [
      recent,
      selected,
      summary,
      personality,
      political,
      profiles,
      truths,
    ] = await Promise.all([
      this.messages.getLastMessages(chatId, this.config.recentHistoryLimit),
      selectedIds.length > 0
        ? this.messages.getMessagesByIds(selectedIds)
        : Promise.resolve([]),
      this.summaries.getSummary(chatId),
      this.personalityRepo.findByChatId(chatId),
      this.politicalRepo.findByChatId(chatId),
      this.profileRepo.findByChat(chatId),
      this.truthRepo.findByChatId(chatId),
    ]);

    const now = new Date().toISOString();
    const mergedById = new Map<number, StoredBehaviorMessage>();

    for (const m of [...recent, ...selected]) {
      if (m.id != null && m.chatId != null) {
        mergedById.set(m.id, m as StoredBehaviorMessage);
      }
    }

    const mergedMessages = [...mergedById.values()].sort((a, b) => a.id - b.id);

    return {
      chatId,
      gate,
      summary,
      messages: mergedMessages,
      triggerMessageIds,
      contextMessageIds,
      state: {
        personality: personality ?? defaultPersonality(chatId, now),
        political: political ?? defaultPolitical(chatId, now),
        profiles,
        truths,
      },
    };
  }
}
