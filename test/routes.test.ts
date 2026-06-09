import { describe, expect, it, vi } from 'vitest';

import {
  type Actions,
  ADMIN_MENU_TITLE,
  CANCEL_DATA,
  makeConversations,
  setupBotRouting,
  USER_MENU_TITLE,
  waitForInputOrCancel,
} from '../src/view/telegram/routes';
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

describe('makeConversations', () => {
  it('does not expose retired interest interval conversations', () => {
    const actions = {} as unknown as Actions;
    const menuRefs = {
      chatSettings: { menu: {} as any, title: '' },
      adminChat: { menu: {} as any, title: '' },
    };
    const convs = makeConversations(actions, menuRefs);

    expect(convs).not.toHaveProperty('adminInterestInterval');
    expect(convs).not.toHaveProperty('userInterestInterval');
  });
});

describe('setupBotRouting /start routing', () => {
  const fullActions = (isAdmin: (id: number) => boolean): Actions =>
    ({
      isAdmin,
      exportData: vi.fn(),
      resetMemory: vi.fn(),
      getChats: vi.fn().mockResolvedValue([]),
      getChatData: vi.fn(),
      requestChatAccess: vi.fn(),
      requestUserAccess: vi.fn(),
      sendChatApprovalRequest: vi.fn(),
      sendUserNotification: vi.fn(),
      approveChat: vi.fn(),
      banChat: vi.fn(),
      unbanChat: vi.fn(),
      approveUser: vi.fn(),
      hasUserAccess: vi.fn(),
      getChatConfig: vi.fn(),
      setHistoryLimit: vi.fn(),
      checkChatStatus: vi.fn().mockResolvedValue('approved'),
      processMessage: vi.fn(),
      log: vi.fn(),
    }) as unknown as Actions;

  const captureCommand = (actions: Actions) => {
    let commandHandler: (ctx: any) => Promise<void> = async () => {};
    const bot = {
      use: vi.fn(),
      command: vi.fn((_names: unknown, h: (ctx: any) => Promise<void>) => {
        commandHandler = h;
      }),
      callbackQuery: vi.fn(),
      on: vi.fn(),
    };
    setupBotRouting(bot as any, actions);
    return commandHandler;
  };

  it('shows the admin menu in the admin chat', async () => {
    const handler = captureCommand(fullActions(() => true));
    const ctx = {
      chat: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      ADMIN_MENU_TITLE,
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });

  it('shows the user menu in a non-admin chat', async () => {
    const handler = captureCommand(fullActions(() => false));
    const ctx = {
      chat: { id: 9 },
      reply: vi.fn().mockResolvedValue(undefined),
    };

    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      USER_MENU_TITLE,
      expect.objectContaining({ reply_markup: expect.anything() })
    );
  });
});
