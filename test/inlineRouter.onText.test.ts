import { describe, expect, it, vi } from 'vitest';

import {
  createRouter,
  route,
  InMemoryStateStore,
  type Route,
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

type TestActions = {
  setValue: (value: string) => Promise<void>;
  getValue: () => Promise<string>;
};

describe('Inline Router onText functionality', () => {
  it('should handle onText in RouteView and process text input', async () => {
    let storedValue = '';
    const actions: TestActions = {
      setValue: vi.fn(async (value: string) => {
        storedValue = value;
      }),
      getValue: vi.fn(async () => storedValue),
    };

    // Create route with onText handler in RouteView
    const inputRoute: Route<TestActions> = route<TestActions>(
      'input_route',
      async () => ({
        text: 'Please enter a value:',
        onText: async ({ text, actions, navigate }) => {
          await actions.setValue(text);
          return navigate(confirmRoute);
        },
      })
    );

    const confirmRoute: Route<TestActions> = route<TestActions>(
      'confirm_route',
      async ({ actions }) => {
        const value = await actions.getValue();
        return {
          text: `You entered: ${value}`,
        };
      }
    );

    const router = createRouter<TestActions>([inputRoute, confirmRoute], [], {
      stateStore: new InMemoryStateStore(),
    });

    const bot = createMockBot();
    const running = router.run(bot, actions);
    const ctx = createMockContext();

    // Navigate to input route
    await running.navigate(ctx, inputRoute);

    // Verify route action was called and rendered input prompt
    expect(ctx.reply).toHaveBeenCalledWith(
      'Please enter a value:',
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      })
    );

    // Simulate text input
    const textCtx = createMockContext({
      message: {
        message_id: 2,
        text: 'test input value',
        from: { id: 1, first_name: 'Test' },
        chat: { id: 1, type: 'private' },
        date: Math.floor(Date.now() / 1000),
      },
    });

    // Get the text handler that was registered
    const textHandlerCall = bot.on.mock.calls.find(
      (call) => call[0] === 'text'
    );
    expect(textHandlerCall).toBeDefined();

    const textHandler = textHandlerCall[1];

    // Call the text handler with our text context
    await textHandler(textCtx, vi.fn());

    // Verify the text was processed and navigation occurred
    expect(actions.setValue).toHaveBeenCalledWith('test input value');
    expect(storedValue).toBe('test input value');

    // Verify navigation to confirm route occurred
    expect(textCtx.reply).toHaveBeenCalledWith(
      'You entered: test input value',
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      })
    );
  });

  it('should handle onText that returns void (explicit navigateBack)', async () => {
    let cancelCalled = false;
    const actions = {
      cancel: vi.fn(async () => {
        cancelCalled = true;
      }),
    };

    const inputRoute: Route<typeof actions> = route(
      'cancel_input_route',
      async () => ({
        text: 'Enter value or type "cancel":',
        onText: async ({ text, actions, navigateBack }) => {
          if (text.toLowerCase() === 'cancel') {
            await actions.cancel();
            await navigateBack(); // Explicitly navigate back
            return;
          }
          // For non-cancel text, return void to stay on current route
          return;
        },
      })
    );

    const mainRoute: Route<typeof actions> = route('main_route', async () => ({
      text: 'Main menu',
    }));

    const router = createRouter(
      [
        {
          route: mainRoute,
          children: [inputRoute],
        },
      ],
      [],
      {
        stateStore: new InMemoryStateStore(),
      }
    );

    const bot = createMockBot();
    const running = router.run(bot, actions);
    const ctx = createMockContext();

    // Navigate to main route first, then input route
    await running.navigate(ctx, mainRoute);
    await running.navigate(ctx, inputRoute);

    // Simulate text input with "cancel"
    const textCtx = createMockContext({
      message: {
        message_id: 3,
        text: 'cancel',
        from: { id: 1, first_name: 'Test' },
        chat: { id: 1, type: 'private' },
        date: Math.floor(Date.now() / 1000),
      },
    });

    const textHandlerCall = bot.on.mock.calls.find(
      (call) => call[0] === 'text'
    );
    const textHandler = textHandlerCall[1];

    await textHandler(textCtx, vi.fn());

    // Verify cancel was called and we navigated back
    expect(actions.cancel).toHaveBeenCalled();
    expect(cancelCalled).toBe(true);

    // Should have navigated back to main route
    expect(textCtx.reply).toHaveBeenCalledWith(
      'Main menu',
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      })
    );
  });

  it('should not process text when no onText handler is active', async () => {
    const actions = {};

    const simpleRoute: Route<typeof actions> = route(
      'simple_route',
      async () => ({
        text: 'Simple route without onText',
      })
    );

    const router = createRouter([simpleRoute], [], {
      stateStore: new InMemoryStateStore(),
    });

    const bot = createMockBot();
    const running = router.run(bot, actions);
    const ctx = createMockContext();

    // Navigate to simple route (no onText)
    await running.navigate(ctx, simpleRoute);

    // Simulate text input
    const textCtx = createMockContext({
      message: {
        message_id: 4,
        text: 'some random text',
        from: { id: 1, first_name: 'Test' },
        chat: { id: 1, type: 'private' },
        date: Math.floor(Date.now() / 1000),
      },
    });

    const textHandlerCall = bot.on.mock.calls.find(
      (call) => call[0] === 'text'
    );
    const textHandler = textHandlerCall[1];

    // Mock the next function to verify it gets called
    const nextFn = vi.fn();

    await textHandler(textCtx, nextFn);

    // Since no onText handler is active, next should be called
    expect(nextFn).toHaveBeenCalled();
  });
});
