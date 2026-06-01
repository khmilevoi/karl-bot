import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptTemplateService } from '../src/application/interfaces/prompts/PromptTemplateService';
import { PromptBuilder } from '../src/application/prompts/PromptBuilder';
import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';
import type { BehaviorPromptMessage } from '../src/application/prompts/PromptTypes';
import type { ChatMessage } from '../src/domain/messages/ChatMessage';

describe('PromptBuilder', () => {
  let templates: PromptTemplateService;

  beforeEach(() => {
    const map: Record<string, string> = {
      chatUser: 'U {{userName}} {{fullName}}',
      priorityRulesSystem: 'rules',
      previousSummary: 'sum {{prev}}',
      userPrompt: 'U {{userMessage}}',
      topicOfDaySystem: 'topic',
      neutralCore: 'neutral-core',
      behaviorGateSystem: 'gate-system',
      behaviorDecisionSystem: 'decision-system',
      personalityState: 'personality:{{personalityStateJson}}',
      politicalState: 'political:{{politicalStateJson}}',
      userProfiles: 'profiles:{{userProfilesJson}}',
      truths: 'truths:{{truthsJson}}',
      behaviorMessages: '{{behaviorMessages}}',
    };
    templates = {
      loadTemplate: vi.fn((name: string) => Promise.resolve(map[name])),
    } as unknown as PromptTemplateService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds prompt', async () => {
    const builder = new PromptBuilder(templates);
    const result = await builder
      .addChatUsers([
        { username: 'u1', fullName: 'F1' },
        { username: 'u2', fullName: 'F2' },
      ])
      .addPriorityRulesSystem()
      .addTopicOfDaySystem()
      .addPreviousSummary('S')
      .build();

    expect(result).toEqual([
      {
        role: 'system',
        content: 'Все пользователи чата:\nU u1 F1\n\nU u2 F2',
      },
      { role: 'system', content: 'rules' },
      { role: 'system', content: 'topic' },
      { role: 'system', content: 'sum S' },
    ]);
  });

  it('adds messages from history', async () => {
    const builder = new PromptBuilder(templates);
    builder.addMessages([
      { role: 'user', content: 'hi' } as ChatMessage,
      { role: 'assistant', content: 'hello' } as ChatMessage,
    ]);

    await expect(builder.build()).resolves.toEqual([
      { role: 'user', content: 'U hi' },
      { role: 'assistant', content: 'U hello' },
    ]);
  });

  it('adds neutral core system message', async () => {
    const builder = new PromptBuilder(templates);
    await expect(builder.addNeutralCore().build()).resolves.toEqual([
      { role: 'system', content: 'neutral-core' },
    ]);
  });

  it('adds behavior gate and decision system messages', async () => {
    const builder = new PromptBuilder(templates);
    await expect(
      builder.addBehaviorGateSystem().addBehaviorDecisionSystem().build()
    ).resolves.toEqual([
      { role: 'system', content: 'gate-system' },
      { role: 'system', content: 'decision-system' },
    ]);
  });

  it('adds personality and political state as JSON', async () => {
    const personality = {
      chatId: 1,
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
      lastUpdatedAt: '2024-01-01',
    } as any;
    const political = {
      chatId: 1,
      ideologySummary: '',
      positions: [],
      uncertaintyAreas: [],
      influenceHistory: [],
      lastUpdatedAt: '2024-01-01',
    } as any;
    const builder = new PromptBuilder(templates);
    const result = await builder
      .addPersonalityState(personality)
      .addPoliticalState(political)
      .build();
    expect(result[0].role).toBe('system');
    expect(result[0].content).toContain('"chatId": 1');
    expect(result[1].role).toBe('system');
  });

  it('adds behavior messages with markers', async () => {
    const msgs: BehaviorPromptMessage[] = [
      {
        id: 1,
        chatId: 10,
        role: 'user',
        content: 'hello',
        username: 'alice',
        messageId: 42,
        userId: 7,
      } as BehaviorPromptMessage,
      {
        id: 2,
        chatId: 10,
        role: 'assistant',
        content: 'hi',
        userId: 0,
      } as BehaviorPromptMessage,
      {
        id: 3,
        chatId: 10,
        role: 'user',
        content: 'batch',
        userId: 8,
      } as BehaviorPromptMessage,
    ];
    const refMap = MessageReferenceMap.fromMessages(msgs);
    const builder = new PromptBuilder(templates);
    const result = await builder
      .addBehaviorMessages(msgs, refMap, {
        triggerMessageIds: [1],
        contextMessageIds: [2],
        batchMessageIds: [3],
      })
      .build();
    expect(result[0].role).toBe('user');
    expect(result[0].content).toContain('[#1]');
    expect(result[0].content).toContain('[TRIGGER]');
    expect(result[0].content).toContain('[GATE_CONTEXT]');
    expect(result[0].content).toContain('[BATCH]');
  });

  it('clears steps after build', async () => {
    const builder = new PromptBuilder(templates);
    builder.addNeutralCore();
    await builder.build();
    builder.addNeutralCore();
    await expect(builder.build()).resolves.toEqual([
      { role: 'system', content: 'neutral-core' },
    ]);
  });
});
