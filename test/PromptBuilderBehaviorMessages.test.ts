import { describe, expect, it } from 'vitest';

import { PromptBuilder } from '../src/application/prompts/PromptBuilder';
import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';
import type { PromptTemplateService } from '../src/application/interfaces/prompts/PromptTemplateService';
import type { BehaviorPromptMessage } from '../src/application/prompts/PromptTypes';

const templates: PromptTemplateService = {
  loadTemplate: async (name: string) =>
    name === 'behaviorMessages' ? '{{behaviorMessages}}' : '',
} as unknown as PromptTemplateService;

const messages: BehaviorPromptMessage[] = [
  {
    id: 150,
    chatId: -100,
    role: 'user',
    content: 'Оооо, москалик',
    username: 'sayboter',
    fullName: 'Даниил Попырев',
    userId: 464151358,
    messageId: 33520,
  },
  {
    id: 161,
    chatId: -100,
    role: 'user',
    content: 'Я не понял',
    username: 'sayboter',
    userId: 464151358,
    messageId: 33538,
    replyText: 'раз на раз в телеге вызывает',
    replyUsername: 'khmilevoi',
  },
];

describe('PromptBuilder.addBehaviorMessages', () => {
  it('renders ordinal refs, reply lines, markers and no raw store/telegram ids', async () => {
    const refMap = MessageReferenceMap.fromMessages(messages);
    const builder = new PromptBuilder(templates);
    const [out] = await builder
      .addBehaviorMessages(messages, refMap, {
        triggerMessageIds: [161],
        contextMessageIds: [],
        batchMessageIds: [161],
      })
      .build();

    expect(out.content).toContain('[#1]');
    expect(out.content).toContain('[#2]');
    expect(out.content).toContain('[TRIGGER]');
    expect(out.content).toContain('[BATCH]');
    expect(out.content).toContain('khmilevoi');
    expect(out.content).toContain('раз на раз в телеге вызывает');
    expect(out.content).toContain('[userId:464151358]');
    expect(out.content).not.toContain('storeId');
    expect(out.content).not.toContain('telegramId');
  });
});
