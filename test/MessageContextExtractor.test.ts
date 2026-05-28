import type { Context } from 'grammy';
import { describe, expect, it } from 'vitest';

import { DefaultMessageContextExtractor } from '../src/application/use-cases/messages/DefaultMessageContextExtractor';
import { MessageContextExtractor } from '../src/application/interfaces/messages/MessageContextExtractor';

describe('MessageContextExtractor', () => {
  const extractor: MessageContextExtractor =
    new DefaultMessageContextExtractor();

  it('extracts username, fullName, reply and quote text', () => {
    const ctx = {
      from: { username: 'user', first_name: 'John', last_name: 'Smith' },
      message: {
        text: 'hi',
        reply_to_message: {
          text: 'hello',
          from: { first_name: 'Jane', last_name: 'Doe' },
        },
        quote: { text: 'quoted' },
      },
    } as unknown as Context;

    const res = extractor.extract(ctx);
    expect(res.username).toBe('user');
    expect(res.fullName).toBe('John Smith');
    expect(res.replyText).toBe('hello');
    expect(res.replyUsername).toBe('Jane Doe');
    expect(res.quoteText).toBe('quoted');
  });

  it('joins text and caption and falls back to names', () => {
    const ctx = {
      from: { first_name: 'Ann' },
      message: {
        reply_to_message: {
          text: 't',
          caption: 'c',
          from: { username: 'user1' },
        },
      },
    } as unknown as Context;

    const res = extractor.extract(ctx);
    expect(res.replyText).toBe('t; c');
    expect(res.replyUsername).toBe('user1');
    expect(res.username).toBe('Имя неизвестно');
    expect(res.fullName).toBe('Ann');
  });

  it('returns defaults when context is empty', () => {
    const res = extractor.extract({} as Context);
    expect(res).toEqual({
      replyText: undefined,
      replyUsername: undefined,
      quoteText: undefined,
      username: 'Имя неизвестно',
      fullName: 'Имя неизвестно',
    });
  });
});
