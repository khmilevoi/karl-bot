import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DSL,
  InMemoryStateStore,
  cb,
  createRouter,
  parseCb,
  route,
  type Route,
  type RouterState,
} from '../src/view/telegram/inline-router';

// Mock Telegraf bot
const createMockBot = () => ({
  on: vi.fn(),
  command: vi.fn(),
  action: vi.fn(),
  use: vi.fn(),
  telegram: {
    setMyCommands: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    editMessageText: vi.fn().mockResolvedValue({ message_id: 1 }),
    editMessageReplyMarkup: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
  },
});

// Mock Context
const createMockContext = (overrides = {}) => ({
  chat: { id: 1 },
  from: { id: 1, first_name: 'Test' },
  message: { message_id: 1 },
  callbackQuery: undefined,
  editMessageText: vi.fn().mockResolvedValue({ message_id: 1 }),
  editMessageReplyMarkup: vi.fn().mockResolvedValue({ message_id: 1 }),
  reply: vi.fn().mockResolvedValue({ message_id: 2 }),
  answerCbQuery: vi.fn().mockResolvedValue(true),
  sendChatAction: vi.fn().mockResolvedValue(true),
  ...overrides,
});

describe('Inline Router Bug Fixes', () => {
  let bot: ReturnType<typeof createMockBot>;
  let stateStore: InMemoryStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    stateStore = new InMemoryStateStore();
    bot = createMockBot();
  });

  describe('parseCb validation', () => {
    it('handles empty string', () => {
      const result = parseCb('');
      expect(result.routeId).toBe('');
      expect(result.args).toEqual([]);
      expect(result.isToken).toBe(false);
    });

    it('handles null/undefined input gracefully', () => {
      // @ts-expect-error testing invalid input
      const result1 = parseCb(null);
      expect(result1.routeId).toBe('');

      // @ts-expect-error testing invalid input
      const result2 = parseCb(undefined);
      expect(result2.routeId).toBe('');
    });

    it('handles malformed callback data', () => {
      const result = parseCb(':::::');
      expect(result.routeId).toBe('');
      expect(result.args.length).toBeGreaterThan(0);
    });

    it('handles valid callback data correctly', () => {
      const result = parseCb('route!v1:arg1:arg2');
      expect(result.routeId).toBe('route');
      expect(result.cbVersion).toBe('v1');
      expect(result.args).toEqual(['arg1', 'arg2']);
      expect(result.isToken).toBe(false);
    });
  });

  describe('cancelWait race condition fix', () => {
    it('handles cancel when awaiting route is on top of stack', async () => {
      const inputRoute: Route = route('input_route', async () => ({
        text: 'Please enter text:',
        onText: async () => ({ text: 'Result' }),
      }));

      const router = createRouter([inputRoute], [], {
        stateStore,
        cancelCallbackData: '__cancel__',
      });
      const running = router.run(bot, {});
      const ctx = createMockContext();

      // Navigate to input route
      await running.navigate(ctx, inputRoute);

      let state = await stateStore.get(1, 1);
      expect(state?.stack).toEqual(['input_route']);
      expect(state?.awaitingTextRouteId).toBe('input_route');

      // Simulate cancel button click
      const actionHandler = bot.action.mock.calls[0]?.[1];
      await actionHandler?.({
        ...ctx,
        callbackQuery: {
          data: '__cancel__',
          message: { message_id: 2 },
        },
      });

      state = await stateStore.get(1, 1);
      expect(state?.stack).toEqual([]);
      expect(state?.awaitingTextRouteId).toBeUndefined();
      expect(state?.currentOnTextHandler).toBeUndefined();
    });

    it('handles multiple cancels without errors', async () => {
      const inputRoute: Route = route('input_route', async () => ({
        text: 'Please enter text:',
        onText: async () => ({ text: 'Result' }),
      }));

      const router = createRouter([inputRoute], [], {
        stateStore,
        cancelCallbackData: '__cancel__',
      });
      const running = router.run(bot, {});
      const ctx = createMockContext();

      // Navigate to input route
      await running.navigate(ctx, inputRoute);

      let state = await stateStore.get(1, 1);
      expect(state?.stack).toEqual(['input_route']);
      expect(state?.awaitingTextRouteId).toBe('input_route');

      // First cancel
      const actionHandler = bot.action.mock.calls[0]?.[1];
      await actionHandler?.({
        ...ctx,
        callbackQuery: {
          data: '__cancel__',
          message: { message_id: 2 },
        },
      });

      state = await stateStore.get(1, 1);
      expect(state?.stack).toEqual([]);
      expect(state?.awaitingTextRouteId).toBeUndefined();

      // Second cancel when nothing is awaiting - should not error
      await actionHandler?.({
        ...ctx,
        callbackQuery: {
          data: '__cancel__',
          message: { message_id: 2 },
        },
      });

      state = await stateStore.get(1, 1);
      expect(state?.stack).toEqual([]);
      expect(state?.awaitingTextRouteId).toBeUndefined();
    });
  });

  describe('empty text handling', () => {
    it('ignores empty text messages when awaiting input', async () => {
      const onTextHandler = vi.fn().mockResolvedValue({ text: 'Result' });
      const inputRoute: Route = route(
        'input_route',
        async () => ({
          text: 'Enter text:',
          onText: onTextHandler,
        }),
        { actionName: 'input_route' }
      );

      const router = createRouter([inputRoute], [], { stateStore });
      const running = router.run(bot, {});
      const ctx = createMockContext();

      // Navigate to input route
      await running.navigate(ctx, inputRoute);

      // Simulate empty text message
      const textHandler = bot.on.mock.calls.find((c) => c[0] === 'text')?.[1];
      const emptyTextCtx = createMockContext({
        message: {
          message_id: 2,
          text: '',
          from: { id: 1 },
          chat: { id: 1 },
          date: 0,
        },
      });

      await textHandler?.(emptyTextCtx, vi.fn());

      // onText handler should NOT be called for empty text
      expect(onTextHandler).not.toHaveBeenCalled();

      // State should still be awaiting
      const state = await stateStore.get(1, 1);
      expect(state?.awaitingTextRouteId).toBe('input_route');
    });

    it('ignores whitespace-only text messages', async () => {
      const onTextHandler = vi.fn().mockResolvedValue({ text: 'Result' });
      const inputRoute: Route = route(
        'input_route',
        async () => ({
          text: 'Enter text:',
          onText: onTextHandler,
        }),
        { actionName: 'input_route' }
      );

      const router = createRouter([inputRoute], [], { stateStore });
      const running = router.run(bot, {});
      const ctx = createMockContext();

      await running.navigate(ctx, inputRoute);

      const textHandler = bot.on.mock.calls.find((c) => c[0] === 'text')?.[1];
      const whitespaceCtx = createMockContext({
        message: {
          message_id: 2,
          text: '   \n\t  ',
          from: { id: 1 },
          chat: { id: 1 },
          date: 0,
        },
      });

      await textHandler?.(whitespaceCtx, vi.fn());

      expect(onTextHandler).not.toHaveBeenCalled();
    });
  });

  describe('onText returning void', () => {
    it('keeps onText handler active when returning void', async () => {
      let callCount = 0;
      const onTextHandler = vi.fn(async () => {
        callCount++;
        // Return void - handler should remain active
        return undefined;
      });

      const inputRoute: Route = route(
        'input_route',
        async () => ({
          text: 'Enter text:',
          onText: onTextHandler,
        }),
        { actionName: 'input_route' }
      );

      const router = createRouter([inputRoute], [], { stateStore });
      const running = router.run(bot, {});
      const ctx = createMockContext();

      await running.navigate(ctx, inputRoute);

      const textHandler = bot.on.mock.calls.find((c) => c[0] === 'text')?.[1];

      // First text input
      const textCtx1 = createMockContext({
        message: {
          message_id: 2,
          text: 'first',
          from: { id: 1 },
          chat: { id: 1 },
          date: 0,
        },
      });
      await textHandler?.(textCtx1, vi.fn());

      expect(callCount).toBe(1);
      let state = await stateStore.get(1, 1);
      expect(state?.awaitingTextRouteId).toBe('input_route');
      expect(state?.currentOnTextHandler).toBeDefined();

      // Second text input - handler should still be active
      const textCtx2 = createMockContext({
        message: {
          message_id: 3,
          text: 'second',
          from: { id: 1 },
          chat: { id: 1 },
          date: 0,
        },
      });
      await textHandler?.(textCtx2, vi.fn());

      expect(callCount).toBe(2);
      state = await stateStore.get(1, 1);
      expect(state?.awaitingTextRouteId).toBe('input_route');
      expect(state?.currentOnTextHandler).toBeDefined();
    });

    it('clears onText handler when returning view', async () => {
      const onTextHandler = vi
        .fn()
        .mockResolvedValue({ text: 'Thank you for your input' });

      const inputRoute: Route = route(
        'input_route',
        async () => ({
          text: 'Enter text:',
          onText: onTextHandler,
        }),
        { actionName: 'input_route' }
      );

      const router = createRouter([inputRoute], [], { stateStore });
      const running = router.run(bot, {});
      const ctx = createMockContext();

      await running.navigate(ctx, inputRoute);

      const textHandler = bot.on.mock.calls.find((c) => c[0] === 'text')?.[1];
      const textCtx = createMockContext({
        message: {
          message_id: 2,
          text: 'input',
          from: { id: 1 },
          chat: { id: 1 },
          date: 0,
        },
      });

      await textHandler?.(textCtx, vi.fn());

      expect(onTextHandler).toHaveBeenCalledTimes(1);

      // After returning view, handler should be cleared
      const state = await stateStore.get(1, 1);
      expect(state?.awaitingTextRouteId).toBeUndefined();
      expect(state?.currentOnTextHandler).toBeUndefined();
    });
  });
});
