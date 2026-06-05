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
    addTopicOfDaySystem: vi.fn(() => {
      calls.push('addTopicOfDaySystem');
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

  it('creates topic of day prompt', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    await director.createTopicOfDayPrompt();

    expect(builder.calls).toEqual([
      'addNeutralCore',
      'addTopicOfDaySystem',
      'build',
    ]);
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
      }
    );
  });

  it('creates topic of day prompt with context', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    await director.createTopicOfDayPrompt({
      chatTitle: 'Chat',
      summary: 'sum',
      users: [{ username: 'u', fullName: 'F' }],
    });

    expect(builder.calls).toEqual([
      'addNeutralCore',
      'addTopicOfDaySystem',
      'addAskSummary',
      'addChatUsers',
      'build',
    ]);
  });
});
