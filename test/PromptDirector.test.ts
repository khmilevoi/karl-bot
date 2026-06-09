import { describe, expect, it, vi } from 'vitest';

import { PromptDirector } from '../src/application/prompts/PromptDirector';
import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';
import type {
  PromptBuilder,
  PromptBuilderFactory,
} from '../src/application/prompts/PromptBuilder';
import type {
  BehaviorPromptContext,
  BehaviorPromptMessage,
} from '../src/application/prompts/PromptTypes';
import type { ChatMessage } from '../src/domain/messages/ChatMessage';

function createBuilder() {
  const calls: string[] = [];
  const builder = {
    calls,
    addPriorityRulesSystem: vi.fn(() => {
      calls.push('addPriorityRulesSystem');
      return builder;
    }),
    addUserPromptSystem: vi.fn(() => {
      calls.push('addUserPromptSystem');
      return builder;
    }),
    addAskSummary: vi.fn((summary?: string) => {
      calls.push('addAskSummary');
      return builder;
    }),
    addChatUsers: vi.fn((users: unknown) => {
      calls.push('addChatUsers');
      return builder;
    }),
    addUserPrompt: vi.fn(() => {
      calls.push('addUserPrompt');
      return builder;
    }),
    addMessages: vi.fn((messages: unknown) => {
      calls.push('addMessages');
      return builder;
    }),
    addSummarizationSystem: vi.fn(() => {
      calls.push('addSummarizationSystem');
      return builder;
    }),
    addPreviousSummary: vi.fn((summary?: string) => {
      calls.push('addPreviousSummary');
      return builder;
    }),
    addNeutralCore: vi.fn(() => {
      calls.push('addNeutralCore');
      return builder;
    }),
    addBehaviorGateSystem: vi.fn(() => {
      calls.push('addBehaviorGateSystem');
      return builder;
    }),
    addBehaviorDecisionSystem: vi.fn(() => {
      calls.push('addBehaviorDecisionSystem');
      return builder;
    }),
    addPersonalityState: vi.fn(() => {
      calls.push('addPersonalityState');
      return builder;
    }),
    addPoliticalState: vi.fn(() => {
      calls.push('addPoliticalState');
      return builder;
    }),
    addUserProfiles: vi.fn(() => {
      calls.push('addUserProfiles');
      return builder;
    }),
    addTruths: vi.fn(() => {
      calls.push('addTruths');
      return builder;
    }),
    addBehaviorBrief: vi.fn(() => {
      calls.push('addBehaviorBrief');
      return builder;
    }),
    addBehaviorMessages: vi.fn(() => {
      calls.push('addBehaviorMessages');
      return builder;
    }),
    addStateEvolutionSystem: vi.fn(() => {
      calls.push('addStateEvolutionSystem');
      return builder;
    }),
    addPersonalitySignals: vi.fn(() => {
      calls.push('addPersonalitySignals');
      return builder;
    }),
    addUserPoliticalProfiles: vi.fn(() => {
      calls.push('addUserPoliticalProfiles');
      return builder;
    }),
    addFactCheckClaimExtractionSystem: vi.fn(() => {
      calls.push('addFactCheckClaimExtractionSystem');
      return builder;
    }),
    addFactCheckVerificationSystem: vi.fn(() => {
      calls.push('addFactCheckVerificationSystem');
      return builder;
    }),
    addFactCheckMessages: vi.fn(() => {
      calls.push('addFactCheckMessages');
      return builder;
    }),
    addFactCheckCandidates: vi.fn(() => {
      calls.push('addFactCheckCandidates');
      return builder;
    }),
    addFactCheckSources: vi.fn(() => {
      calls.push('addFactCheckSources');
      return builder;
    }),
    build: vi.fn(async () => {
      calls.push('build');
      return 'result';
    }),
  };
  return builder as unknown as PromptBuilder & { calls: string[] };
}

describe('PromptDirector', () => {
  it('creates summary prompt', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const history: ChatMessage[] = [
      {
        role: 'user',
        content: 'hi',
        username: 'u1',
        fullName: 'F1',
        messageId: 1,
      },
      { role: 'assistant', content: 'hello' },
    ];
    await director.createSummaryPrompt(history, 'prev');

    expect(builder.calls).toEqual([
      'addSummarizationSystem',
      'addPreviousSummary',
      'addMessages',
      'build',
    ]);
    expect(builder.addPreviousSummary).toHaveBeenCalledWith('prev');
    expect(builder.addMessages).toHaveBeenCalledWith(history);
  });

  it('creates behavior gate prompt', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const messages: BehaviorPromptMessage[] = [
      {
        id: 1,
        chatId: 10,
        role: 'user',
        content: 'hi',
        userId: 7,
      } as BehaviorPromptMessage,
    ];
    const refMap = MessageReferenceMap.fromMessages(messages);
    await director.createBehaviorGatePrompt(messages, refMap);

    expect(builder.calls).toEqual([
      'addBehaviorGateSystem',
      'addBehaviorMessages',
      'build',
    ]);
    expect(builder.addBehaviorMessages).toHaveBeenCalledWith(messages, refMap);
  });

  it('creates behavior decision prompt in correct order', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const context: BehaviorPromptContext = {
      summary: 'prev-summary',
      messages: [
        {
          id: 1,
          chatId: 10,
          role: 'user',
          content: 'hi',
          userId: 7,
        } as BehaviorPromptMessage,
      ],
      triggerMessageIds: [1],
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
    const refMap = MessageReferenceMap.fromMessages(context.messages);
    await director.createBehaviorDecisionPrompt(context, refMap);

    expect(builder.calls).toEqual([
      'addNeutralCore',
      'addBehaviorDecisionSystem',
      'addAskSummary',
      'addPersonalityState',
      'addPoliticalState',
      'addUserProfiles',
      'addUserPoliticalProfiles',
      'addTruths',
      'addBehaviorBrief',
      'addBehaviorMessages',
      'build',
    ]);
    expect(builder.addAskSummary).toHaveBeenCalledWith('prev-summary');
    expect(builder.addBehaviorMessages).toHaveBeenCalledWith(
      context.messages,
      refMap,
      {
        triggerMessageIds: context.triggerMessageIds,
        contextMessageIds: context.contextMessageIds,
        batchMessageIds: context.batchMessageIds,
      },
      context.selfIdentity
    );
  });

  it('creates fact check extraction prompt', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const batchMsg: ChatMessage = {
      role: 'user',
      content: 'msg',
      messageId: 1,
    };
    await director.createFactCheckExtractionPrompt({
      batchMessages: [batchMsg],
      contextMessages: [],
    });

    expect(builder.calls).toEqual([
      'addFactCheckClaimExtractionSystem',
      'addFactCheckMessages',
      'build',
    ]);
    expect(builder.addFactCheckMessages).toHaveBeenCalledWith({
      batchMessages: [batchMsg],
      contextMessages: [],
    });
  });

  it('creates fact check verification prompt', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const batchMsg: ChatMessage = {
      role: 'user',
      content: 'msg',
      messageId: 1,
    };
    const candidate = {
      messageId: 1,
      claimText: 'claim',
      category: 'external_fact' as const,
      needsExternalSources: true,
      riskLevel: 'low' as const,
      whyCheckable: 'reason',
      contextMessageIds: [],
    };
    const source = {
      url: 'https://example.com',
      title: 'Source',
      publisher: null,
      snippet: 'text',
      reliability: 'authoritative',
    };
    await director.createFactCheckVerificationPrompt({
      candidates: [candidate],
      batchMessages: [batchMsg],
      contextMessages: [],
      sources: [source],
    });

    expect(builder.calls).toEqual([
      'addFactCheckVerificationSystem',
      'addFactCheckMessages',
      'addFactCheckCandidates',
      'addFactCheckSources',
      'build',
    ]);
    expect(builder.addFactCheckCandidates).toHaveBeenCalledWith({
      candidates: [candidate],
    });
    expect(builder.addFactCheckSources).toHaveBeenCalledWith({
      sources: [source],
    });
  });
});
