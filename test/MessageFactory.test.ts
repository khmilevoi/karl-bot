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

  it('fromUser carries reply target ids', () => {
    const ctx = {
      message: { text: 'привет', message_id: 10 },
      from: { id: 7, first_name: 'Олег' },
      chat: { id: -100 },
    } as unknown as Context;
    const metaWithReply: MessageContext = {
      username: 'oleg',
      fullName: 'Олег',
      replyText: 'orig',
      replyUsername: 'Анна',
      replyToMessageId: 555,
      replyToUserId: 42,
    };

    const stored = MessageFactory.fromUser(ctx, metaWithReply);

    expect(stored.replyToMessageId).toBe(555);
    expect(stored.replyToUserId).toBe(42);
    expect(stored.replyText).toBe('orig');
  });

  it('fromUserContent (voice) carries reply context', () => {
    const ctx = {
      message: { message_id: 11 },
      from: { id: 7, first_name: 'Олег' },
      chat: { id: -100 },
    } as unknown as Context;
    const metaWithReply: MessageContext = {
      username: 'oleg',
      fullName: 'Олег',
      replyText: 'orig',
      replyUsername: 'Анна',
      quoteText: 'q',
      replyToMessageId: 555,
      replyToUserId: 42,
    };

    const stored = MessageFactory.fromUserContent(
      ctx,
      metaWithReply,
      'распознанный текст',
      'voice'
    );

    expect(stored.replyToMessageId).toBe(555);
    expect(stored.replyToUserId).toBe(42);
    expect(stored.replyText).toBe('orig');
    expect(stored.quoteText).toBe('q');
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
