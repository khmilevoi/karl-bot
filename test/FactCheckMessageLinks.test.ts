import { describe, expect, it } from 'vitest';

import { buildTelegramMessageUrl } from '../src/application/fact-checking/FactCheckMessageLinks';

describe('FactCheckMessageLinks', () => {
  it('builds supergroup URL using -100 prefix', () => {
    expect(
      buildTelegramMessageUrl({
        chatId: -1001234567890,
        chatUsername: null,
        telegramMessageId: 55,
      })
    ).toBe('https://t.me/c/1234567890/55');
  });

  it('builds public chat URL using username', () => {
    expect(
      buildTelegramMessageUrl({
        chatId: -100123,
        chatUsername: 'mychat',
        telegramMessageId: 55,
      })
    ).toBe('https://t.me/mychat/55');
  });

  it('returns null when telegramMessageId is null', () => {
    expect(
      buildTelegramMessageUrl({
        chatId: -1001234567890,
        chatUsername: null,
        telegramMessageId: null,
      })
    ).toBeNull();
  });

  it('returns null for private chat without username', () => {
    expect(
      buildTelegramMessageUrl({
        chatId: 123,
        chatUsername: null,
        telegramMessageId: 5,
      })
    ).toBeNull();
  });

  it('prefers username over chatId format', () => {
    expect(
      buildTelegramMessageUrl({
        chatId: -1001234567890,
        chatUsername: 'mypublicchat',
        telegramMessageId: 10,
      })
    ).toBe('https://t.me/mypublicchat/10');
  });
});
