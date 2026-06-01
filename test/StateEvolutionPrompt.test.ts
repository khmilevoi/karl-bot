import { describe, expect, it, vi } from 'vitest';

import type {
  PromptBuilder,
  PromptBuilderFactory,
} from '../src/application/prompts/PromptBuilder';
import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';
import { PromptDirector } from '../src/application/prompts/PromptDirector';
import type { StateEvolutionContext } from '../src/application/behavior/BehaviorTypes';
import type { BehaviorPromptMessage } from '../src/application/prompts/PromptTypes';

function createBuilder() {
  const calls: string[] = [];
  const builder = {
    calls,
    addNeutralCore: vi.fn(() => {
      calls.push('addNeutralCore');
      return builder;
    }),
    addStateEvolutionSystem: vi.fn(() => {
      calls.push('addStateEvolutionSystem');
      return builder;
    }),
    addAskSummary: vi.fn(() => {
      calls.push('addAskSummary');
      return builder;
    }),
    addPersonalityState: vi.fn(() => {
      calls.push('addPersonalityState');
      return builder;
    }),
    addPersonalitySignals: vi.fn(() => {
      calls.push('addPersonalitySignals');
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
    addUserPoliticalProfiles: vi.fn(() => {
      calls.push('addUserPoliticalProfiles');
      return builder;
    }),
    addTruths: vi.fn(() => {
      calls.push('addTruths');
      return builder;
    }),
    addBehaviorMessages: vi.fn(() => {
      calls.push('addBehaviorMessages');
      return builder;
    }),
    build: vi.fn(async () => {
      calls.push('build');
      return [];
    }),
  };
  return builder as unknown as PromptBuilder & { calls: string[] };
}

const baseContext: StateEvolutionContext = {
  chatId: 1,
  maxStateImpactRisk: 'medium',
  personalitySignals: [],
  summary: 'test summary',
  messages: [
    {
      id: 1,
      chatId: 1,
      role: 'user',
      content: 'hello',
      userId: 10,
    } as BehaviorPromptMessage,
  ],
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

describe('PromptDirector.createStateEvolutionPrompt', () => {
  it('calls builder steps in the correct order', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const refMap = MessageReferenceMap.fromMessages(baseContext.messages);

    await director.createStateEvolutionPrompt(baseContext, refMap);

    expect(builder.calls).toEqual([
      'addNeutralCore',
      'addStateEvolutionSystem',
      'addAskSummary',
      'addPersonalityState',
      'addPersonalitySignals',
      'addPoliticalState',
      'addUserProfiles',
      'addUserPoliticalProfiles',
      'addTruths',
      'addBehaviorMessages',
      'build',
    ]);
  });

  it('passes summary to addAskSummary', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const refMap = MessageReferenceMap.fromMessages(baseContext.messages);

    await director.createStateEvolutionPrompt(
      {
        ...baseContext,
        summary: 'my summary',
      },
      refMap
    );

    expect(builder.addAskSummary).toHaveBeenCalledWith('my summary');
  });

  it('passes personalitySignals to addPersonalitySignals', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const refMap = MessageReferenceMap.fromMessages(baseContext.messages);

    const signals = [
      {
        area: 'identity' as const,
        polarity: 'reinforce' as const,
        text: 'curious',
        evidenceMessageIds: [1],
        status: 'active' as const,
        createdAt: '2026-05-31T00:00:00.000Z',
      },
    ];

    await director.createStateEvolutionPrompt(
      {
        ...baseContext,
        personalitySignals: signals,
      },
      refMap
    );

    expect(builder.addPersonalitySignals).toHaveBeenCalledWith(signals);
  });

  it('passes state.userPolitical to addUserPoliticalProfiles', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const refMap = MessageReferenceMap.fromMessages(baseContext.messages);

    const userPolitical = [
      {
        chatId: 1,
        userId: 10,
        notes: [],
        compass: {
          economic: 2,
          social: -1,
          economicConfidence: 0.6,
          socialConfidence: 0.4,
        },
        updatedAt: '2026-05-31T00:00:00.000Z',
      },
    ];

    await director.createStateEvolutionPrompt(
      {
        ...baseContext,
        state: { ...baseContext.state, userPolitical },
      },
      refMap
    );

    expect(builder.addUserPoliticalProfiles).toHaveBeenCalledWith(
      userPolitical
    );
  });

  it('passes messages to addBehaviorMessages', async () => {
    const builder = createBuilder();
    const factory: PromptBuilderFactory = () => builder;
    const director = new PromptDirector(factory);
    const refMap = MessageReferenceMap.fromMessages(baseContext.messages);

    await director.createStateEvolutionPrompt(baseContext, refMap);

    expect(builder.addBehaviorMessages).toHaveBeenCalledWith(
      baseContext.messages,
      refMap
    );
  });
});
