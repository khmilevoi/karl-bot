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
    expect(out.content).toContain('[source:text]');
    expect(out.content).not.toContain('storeId');
    expect(out.content).not.toContain('telegramId');
  });

  it('marks a reply to the bot as addressed to you', async () => {
    const botMessages: BehaviorPromptMessage[] = [
      {
        id: 1,
        chatId: -100,
        role: 'user',
        content: 'ты тут?',
        userId: 7,
        username: 'oleg',
        messageId: 100,
        replyToUserId: 999,
        replyText: 'предыдущий ответ бота',
      },
    ];
    const refMap = MessageReferenceMap.fromMessages(botMessages);
    const builder = new PromptBuilder(templates);
    const [out] = await builder
      .addBehaviorMessages(botMessages, refMap, undefined, {
        id: 999,
        username: 'assistant_bot',
        name: 'Bot',
      })
      .build();
    expect(out.content).toContain('[to:you]');
    expect(out.content).toContain('ОТВЕЧАЮТ ТЕБЕ');
  });

  it('marks a reply to another user and links #N when in context', async () => {
    const chatMessages: BehaviorPromptMessage[] = [
      {
        id: 5,
        chatId: -100,
        role: 'user',
        content: 'оригинал',
        userId: 8,
        username: 'anna',
        messageId: 200,
      },
      {
        id: 6,
        chatId: -100,
        role: 'user',
        content: 'согласен',
        userId: 7,
        username: 'oleg',
        messageId: 201,
        replyToUserId: 8,
        replyToMessageId: 200,
        replyText: 'оригинал',
        replyUsername: 'anna',
      },
    ];
    const refMap = MessageReferenceMap.fromMessages(chatMessages);
    const builder = new PromptBuilder(templates);
    const [out] = await builder
      .addBehaviorMessages(chatMessages, refMap, undefined, {
        id: 999,
        username: 'assistant_bot',
        name: 'Bot',
      })
      .build();
    expect(out.content).toContain('[to:@anna]');
    expect(out.content).toContain('на #1');
  });

  it('marks unrelated chatter as to:room', async () => {
    const roomMessages: BehaviorPromptMessage[] = [
      {
        id: 9,
        chatId: -100,
        role: 'user',
        content: 'погода супер',
        userId: 8,
        username: 'anna',
        messageId: 300,
      },
    ];
    const refMap = MessageReferenceMap.fromMessages(roomMessages);
    const builder = new PromptBuilder(templates);
    const [out] = await builder
      .addBehaviorMessages(roomMessages, refMap, undefined, {
        id: 999,
        username: 'assistant_bot',
        name: 'Bot',
      })
      .build();
    expect(out.content).toContain('[to:room]');
  });

  it('renders voice messages with an explicit source field', async () => {
    const refMap = MessageReferenceMap.fromMessages(messages);
    const builder = new PromptBuilder(templates);
    const [out] = await builder
      .addBehaviorMessages(
        [
          {
            ...messages[0],
            content: 'Bot, привет',
            sourceType: 'voice',
            processingStatus: 'ready',
          },
        ],
        refMap,
        {
          triggerMessageIds: [150],
          contextMessageIds: [],
          batchMessageIds: [],
        }
      )
      .build();

    expect(out.content).toContain('[source:voice]');
    expect(out.content).toContain('Bot, привет');
    expect(out.content).not.toContain('[voice]');
  });
});
