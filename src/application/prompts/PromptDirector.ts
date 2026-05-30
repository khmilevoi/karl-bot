import { inject, injectable, type ServiceIdentifier } from 'inversify';

import type { ChatMessage } from '@/domain/messages/ChatMessage';
import type { TriggerReason } from '@/domain/triggers/Trigger';

import {
  PROMPT_BUILDER_FACTORY_ID,
  type PromptBuilderFactory,
} from './PromptBuilder';
import type { PromptMessage } from './PromptMessage';
import type {
  BehaviorPromptContext,
  BehaviorPromptMessage,
  PromptChatUser,
} from './PromptTypes';

@injectable()
export class PromptDirector {
  constructor(
    @inject(PROMPT_BUILDER_FACTORY_ID)
    private readonly builderFactory: PromptBuilderFactory
  ) {}

  async createAnswerPrompt(
    history: ChatMessage[],
    summary?: string,
    trigger?: TriggerReason
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addPersona()
      .addPriorityRulesSystem()
      .addUserPromptSystem()
      .addAskSummary(summary)
      .addReplyTrigger(trigger?.why, trigger?.message)
      .addChatUsers(this.extractChatUsers(history))
      .addMessages(history)
      .build();
  }

  async createSummaryPrompt(
    history: ChatMessage[],
    previousSummary?: string
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addSummarizationSystem()
      .addPreviousSummary(previousSummary)
      .addMessages(history)
      .build();
  }

  async createInterestPrompt(history: ChatMessage[]): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addPersona()
      .addCheckInterest()
      .addMessages(history)
      .build();
  }

  async createAssessUsersPrompt(
    history: ChatMessage[],
    prevAttitudes?: { username: string; attitude: string }[]
  ): Promise<PromptMessage[]> {
    const prevUsers = this.mapPrevAttitudes(history, prevAttitudes);
    return this.builderFactory()
      .addPersona()
      .addAssessUsers()
      .addChatUsers(prevUsers)
      .addMessages(history)
      .build();
  }

  async createTopicOfDayPrompt(params?: {
    chatTitle?: string;
    users?: PromptChatUser[];
    summary?: string;
  }): Promise<PromptMessage[]> {
    const builder = this.builderFactory()
      .addPersona()
      .addTopicOfDaySystem({ chatTitle: params?.chatTitle });
    if (params?.summary) {
      builder.addAskSummary(params.summary);
    }
    if (params?.users && params.users.length > 0) {
      builder.addChatUsers(params.users);
    }
    return builder.build();
  }

  async createBehaviorGatePrompt(
    messages: BehaviorPromptMessage[]
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addBehaviorGateSystem()
      .addBehaviorMessages(messages)
      .build();
  }

  async createBehaviorDecisionPrompt(
    context: BehaviorPromptContext
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addNeutralCore()
      .addBehaviorDecisionSystem()
      .addAskSummary(context.summary)
      .addPersonalityState(context.state.personality)
      .addPoliticalState(context.state.political)
      .addUserProfiles(context.state.profiles)
      .addTruths(context.state.truths)
      .addBehaviorMessages(context.messages, {
        triggerMessageIds: context.triggerMessageIds,
        contextMessageIds: context.contextMessageIds,
        batchMessageIds: context.batchMessageIds,
      })
      .build();
  }

  private extractChatUsers(
    history: ChatMessage[]
  ): { username: string; fullName: string; attitude: string }[] {
    const infoMap = new Map<string, { fullName: string; attitude: string }>();
    for (const m of history) {
      if (m.role === 'user' && m.username && m.attitude) {
        if (!infoMap.has(m.username)) {
          const parts = [m.firstName, m.lastName].filter(Boolean).join(' ');
          const fullName = m.fullName ?? (parts !== '' ? parts : 'N/A');
          infoMap.set(m.username, { fullName, attitude: m.attitude });
        }
      }
    }
    return Array.from(infoMap, ([username, v]) => ({
      username,
      fullName: v.fullName,
      attitude: v.attitude,
    }));
  }

  private mapPrevAttitudes(
    history: ChatMessage[],
    prev?: { username: string; attitude: string }[]
  ): { username: string; fullName: string; attitude: string }[] {
    if (!prev || prev.length === 0) {
      return [];
    }
    const nameMap = new Map<string, string>();
    for (const m of history) {
      if (m.role === 'user' && m.username) {
        if (!nameMap.has(m.username)) {
          const parts = [m.firstName, m.lastName].filter(Boolean).join(' ');
          const fullName = m.fullName ?? (parts !== '' ? parts : 'N/A');
          nameMap.set(m.username, fullName);
        }
      }
    }
    return prev.map((u) => ({
      username: u.username,
      fullName: nameMap.get(u.username) ?? 'N/A',
      attitude: u.attitude,
    }));
  }
}

export const PROMPT_DIRECTOR_ID = Symbol.for(
  'PromptDirector'
) as ServiceIdentifier<PromptDirector>;

/*
 * PromptDirector rules:
 * - obtain a fresh PromptBuilder for every prompt
 * - chain builder steps in a declarative sequence
 * - include optional parts like summaries, triggers or previous attitudes
 *   only when corresponding parameters are provided
 * - use addCheckInterest and addAssessUsers for interest and user assessment flows
 */
