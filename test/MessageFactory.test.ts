import type { Context } from 'grammy';
import { describe, expect, it } from 'vitest';

import type { MessageContext } from '../src/application/interfaces/messages/MessageContextExtractor';
import { MessageFactory } from '../src/application/use-cases/messages/MessageFactory';

describe('MessageFactory', () => {
  const meta: MessageContext = {
    replyText: 'r',
    replyUsername: 'ru',
    quoteText: 'q',
    username: 'user',
    fullName: 'User Name',
  };

  const createCtx = (): Context =>
    ({
      message: { text: 'hi', message_id: 10 },
      from: { id: 1, first_name: 'First', last_name: 'Last' },
      chat: { id: 2, title: 'Chat' },
    }) as unknown as Context;

  it('fromUser fills all fields', () => {
    const ctx = createCtx();
    const res = MessageFactory.fromUser(ctx, meta);
    expect(res).toEqual({
      role: 'user',
      content: 'hi',
      username: 'user',
      fullName: 'User Name',
      replyText: 'r',
      replyUsername: 'ru',
      quoteText: 'q',
      userId: 1,
      messageId: 10,
      firstName: 'First',
      lastName: 'Last',
      chatId: 2,
      chatTitle: 'Chat',
    });
  });

  it('fromUser throws without text', () => {
    const ctx = {
      message: { message_id: 10 },
      chat: { id: 1 },
    } as unknown as Context;
    expect(() => MessageFactory.fromUser(ctx, meta)).toThrow(
      'Нет текста сообщения'
    );
  });

  it('fromAssistant uses ctx.me and chatId', () => {
    const ctx = {
      me: { username: 'bot' },
      chat: { id: 3, title: 'C' },
    } as unknown as Context;
    const res = MessageFactory.fromAssistant(ctx, 'answer');
    expect(res).toEqual({
      role: 'assistant',
      content: 'answer',
      username: 'bot',
      chatId: 3,
      chatTitle: 'C',
    });
  });
});
