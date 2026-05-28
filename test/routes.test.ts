import { describe, expect, it, vi } from 'vitest';

import { CANCEL_DATA, waitForInputOrCancel } from '../src/view/telegram/routes';
import type { BotContext } from '../src/view/telegram/context';

const makeCtx = () =>
  ({
    chat: { id: 100 },
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    },
  }) as unknown as BotContext;

const textUpdate = (text: string, id = 9) => ({
  callbackQuery: undefined,
  message: { text, message_id: id },
  hasCallbackQuery: () => false,
  has: () => true,
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
});

const cancelUpdate = () => ({
  callbackQuery: { data: CANCEL_DATA },
  message: undefined,
  hasCallbackQuery: () => true,
  has: () => false,
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
});

const toNum = (text: string): number | null => {
  const n = parseInt(text, 10);
  return !isNaN(n) && n >= 1 && n <= 50 ? n : null;
};

describe('waitForInputOrCancel', () => {
  it('returns the validated value on valid input', async () => {
    const ctx = makeCtx();
    const conversation = {
      waitUntil: vi.fn().mockResolvedValue(textUpdate('5')),
    } as any;

    const result = await waitForInputOrCancel(
      conversation,
      ctx,
      'prompt',
      toNum
    );

    expect(result).toBe(5);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('returns null when cancelled', async () => {
    const ctx = makeCtx();
    const update = cancelUpdate();
    const conversation = {
      waitUntil: vi.fn().mockResolvedValue(update),
    } as any;

    const result = await waitForInputOrCancel(
      conversation,
      ctx,
      'prompt',
      toNum
    );

    expect(result).toBeNull();
    expect(update.answerCallbackQuery).toHaveBeenCalledWith('Отменено');
  });

  it('retries once on invalid input then accepts a valid value', async () => {
    const ctx = makeCtx();
    const conversation = {
      waitUntil: vi
        .fn()
        .mockResolvedValueOnce(textUpdate('abc'))
        .mockResolvedValueOnce(textUpdate('7')),
    } as any;

    const result = await waitForInputOrCancel(
      conversation,
      ctx,
      'prompt',
      toNum
    );

    expect(result).toBe(7);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns null after two invalid attempts', async () => {
    const ctx = makeCtx();
    const conversation = {
      waitUntil: vi.fn().mockResolvedValue(textUpdate('abc')),
    } as any;

    const result = await waitForInputOrCancel(
      conversation,
      ctx,
      'prompt',
      toNum
    );

    expect(result).toBeNull();
    expect(ctx.api.sendMessage).toHaveBeenLastCalledWith(
      100,
      'Слишком много попыток. Возвращаюсь в меню.'
    );
  });
});
