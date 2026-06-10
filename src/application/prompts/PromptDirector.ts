import { inject, injectable, type ServiceIdentifier } from 'inversify';

import type { ChatMessage } from '@/domain/messages/ChatMessage';

import {
  PROMPT_BUILDER_FACTORY_ID,
  type PromptBuilderFactory,
} from './PromptBuilder';
import type { PromptMessage } from './PromptMessage';
import type {
  BehaviorPromptContext,
  BehaviorPromptMessage,
} from './PromptTypes';
import type { MessageReferenceMap } from './MessageReferenceMap';
import type { StateEvolutionContext } from '../behavior/BehaviorTypes';
import type {
  FactCheckExtractionPromptContext,
  FactCheckVerificationPromptContext,
} from '@/application/fact-checking/FactCheckPromptContext';

@injectable()
export class PromptDirector {
  constructor(
    @inject(PROMPT_BUILDER_FACTORY_ID)
    private readonly builderFactory: PromptBuilderFactory
  ) {}

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

  async createBehaviorGatePrompt(
    messages: BehaviorPromptMessage[],
    refMap: MessageReferenceMap
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addBehaviorGateSystem()
      .addBehaviorMessages(messages, refMap)
      .build();
  }

  async createBehaviorDecisionPrompt(
    context: BehaviorPromptContext,
    refMap: MessageReferenceMap
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addNeutralCore()
      .addBehaviorDecisionSystem()
      .addAskSummary(context.summary)
      .addPersonalityState(context.state.personality)
      .addPoliticalState(context.state.political)
      .addUserProfiles(context.state.profiles)
      .addUserPoliticalProfiles(context.state.userPolitical)
      .addTruths(context.state.truths)
      .addBehaviorBrief(context.state, context.messages, context.selfIdentity)
      .addBehaviorMessages(
        context.messages,
        refMap,
        {
          triggerMessageIds: context.triggerMessageIds,
          contextMessageIds: context.contextMessageIds,
          batchMessageIds: context.batchMessageIds,
        },
        context.selfIdentity
      )
      .build();
  }

  async createFactCheckExtractionPrompt(
    context: FactCheckExtractionPromptContext
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addFactCheckClaimExtractionSystem()
      .addFactCheckMessages({
        batchMessages: context.batchMessages,
        contextMessages: context.contextMessages,
      })
      .build();
  }

  async createFactCheckVerificationPrompt(
    context: FactCheckVerificationPromptContext
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addFactCheckVerificationSystem()
      .addFactCheckMessages({
        batchMessages: context.batchMessages,
        contextMessages: context.contextMessages,
      })
      .addFactCheckCandidates({ candidates: context.candidates })
      .addFactCheckSources({ sources: context.sources })
      .build();
  }

  async createStateEvolutionPrompt(
    context: StateEvolutionContext,
    refMap: MessageReferenceMap
  ): Promise<PromptMessage[]> {
    return this.builderFactory()
      .addNeutralCore()
      .addStateEvolutionSystem()
      .addAskSummary(context.summary)
      .addPersonalityState(context.state.personality)
      .addPersonalitySignals(context.personalitySignals)
      .addPoliticalState(context.state.political)
      .addUserProfiles(context.state.profiles)
      .addUserPoliticalProfiles(context.state.userPolitical)
      .addTruths(context.state.truths)
      .addBehaviorMessages(context.messages, refMap)
      .build();
  }
}

export const PROMPT_DIRECTOR_ID = Symbol.for(
  'PromptDirector'
) as ServiceIdentifier<PromptDirector>;

/*
 * PromptDirector rules:
 * - obtain a fresh PromptBuilder for every prompt
 * - chain builder steps in a declarative sequence
 * - include optional parts like summaries only when corresponding parameters are provided
 */
