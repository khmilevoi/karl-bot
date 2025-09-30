import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DSL,
  InMemoryStateStore,
  InMemoryTokenStore,
  RouterUserError,
  cb,
  cbTok,
  createRouter,
  parseCb,
  type Button,
  type Route,
  type RouteNode,
  type RouterState,
  type StartOptions,
} from '../src/view/telegram/inline-router';

describe('inline-router helpers', () => {
  describe('cb and parseCb', () => {
    it('handles route IDs without arguments', () => {
      const data = cb('home');
      expect(data).toBe('home!v1');
      const parsed = parseCb(data);
      expect(parsed).toEqual({
        routeId: 'home',
        cbVersion: 'v1',
        args: [],
        isToken: false,
        token: undefined,
      });
    });

    it('handles route IDs with arguments', () => {
      const data = cb('route', ['a', 1, 'test'], 'v2');
      expect(data).toBe('route!v2:a:1:test');
      const parsed = parseCb(data);
      expect(parsed).toEqual({
        routeId: 'route',
        cbVersion: 'v2',
        args: ['a', '1', 'test'],
        isToken: false,
        token: undefined,
      });
    });

    it('handles legacy format without version', () => {
      const parsed = parseCb('oldroute:arg1:arg2');
      expect(parsed).toEqual({
        routeId: 'oldroute',
        cbVersion: undefined,
        args: ['arg1', 'arg2'],
        isToken: false,
        token: undefined,
      });
    });
  });

  describe('cbTok', () => {
    it('creates tokenized callback data', async () => {
      const tokenStore = {
        save: vi.fn().mockReturnValue('token123'),
        load: vi.fn(),
      };

      const payload = { userId: 123, action: 'delete' };
      const data = await cbTok(
        'action',
        tokenStore as any,
        payload,
        5000,
        'v2'
      );

      expect(data).toBe('action!v2:t:token123');
      expect(tokenStore.save).toHaveBeenCalledWith(payload, 5000);

      const parsed = parseCb(data);
      expect(parsed.isToken).toBe(true);
      expect(parsed.token).toBe('token123');
      expect(parsed.routeId).toBe('action');
    });
  });
});

describe('inline-router navigation and state management', () => {
  let bot: any;
  let stateStore: InMemoryStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    stateStore = new InMemoryStateStore();
    bot = {
      telegram: { setMyCommands: vi.fn() },
      action: vi.fn(),
      command: vi.fn(),
      on: vi.fn(),
    };
  });

  describe('Navigation Stack Management', () => {
    it('maintains correct navigation stack', async () => {
      const homeRoute: Route = {
        id: 'home',
        actionName: 'home',
        action: vi.fn().mockResolvedValue({
          text: 'Home',
          buttons: DSL.rows([
            { text: 'Go to Profile', callback: cb('profile') },
          ]),
        }),
      };

      const profileRoute: Route = {
        id: 'profile',
        action: vi.fn().mockResolvedValue({
          text: 'Profile',
          buttons: DSL.rows([{ text: 'Settings', callback: cb('settings') }]),
        }),
      };

      const settingsRoute: Route = {
        id: 'settings',
        action: vi.fn().mockResolvedValue({
          text: 'Settings',
        }),
      };

      const router = createRouter(
        [homeRoute, profileRoute, settingsRoute],
        [],
        {
          stateStore,
        }
      );
      const running = router.run(bot, {});

      const ctx = {
        chat: { id: 1 },
        from: { id: 1 },
        reply: vi.fn().mockResolvedValue({ message_id: 100 }),
        answerCbQuery: vi.fn(),
        editMessageText: vi.fn(),
        editMessageReplyMarkup: vi.fn(),
      };

      // Navigate: home -> profile -> settings
      await running.navigate(ctx, homeRoute);
      await running.navigate(ctx, profileRoute);
      await running.navigate(ctx, settingsRoute);

      const state = await stateStore.get(1, 1);
      expect(state?.stack).toEqual(['home', 'profile', 'settings']);

      // Navigate back: settings -> profile
      await running.navigateBack(ctx);
      const stateAfterBack = await stateStore.get(1, 1);
      expect(stateAfterBack?.stack).toEqual(['home', 'profile']);
      expect(profileRoute.action).toHaveBeenCalledTimes(2); // Initial + back navigation
    });

    it('handles empty stack correctly', async () => {
      const route: Route = {
        id: 'test',
        action: vi.fn().mockResolvedValue({ text: 'Test' }),
      };

      const router = createRouter([route], [], { stateStore });
      const running = router.run(bot, {});

      const ctx = {
        chat: { id: 1 },
        from: { id: 1 },
        reply: vi.fn(),
        answerCbQuery: vi.fn(),
        editMessageReplyMarkup: vi.fn(),
      };

      // Navigate back on empty stack should clear keyboard
      await running.navigateBack(ctx);
      expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith(undefined);
    });
  });

  describe('Parameter Management', () => {
    it('passes and retrieves route parameters correctly', async () => {
      const userRoute: Route<any, { userId: number; name: string }> = {
        id: 'user',
        action: vi.fn().mockImplementation(({ params }) => ({
          text: `User: ${params.name} (ID: ${params.userId})`,
        })),
      };

      const router = createRouter([userRoute], [], { stateStore });
      const running = router.run(bot, {});

      const ctx = {
        chat: { id: 1 },
        from: { id: 1 },
        reply: vi.fn().mockResolvedValue({ message_id: 100 }),
        answerCbQuery: vi.fn(),
      };

      const params = { userId: 123, name: 'John' };
      await running.navigate(ctx, userRoute, params);

      expect(userRoute.action).toHaveBeenCalledWith(
        expect.objectContaining({
          params,
        })
      );

      const state = await stateStore.get(1, 1);
      expect(state?.params['user']).toEqual(params);
    });
  });

  describe('Text Input Flow', () => {
    it('manages awaiting text state correctly', async () => {
      const onTextHandler = vi
        .fn()
        .mockResolvedValue({ text: 'Input received' });
      const inputRoute: Route = {
        id: 'input',
        actionName: 'input',
        action: vi.fn().mockResolvedValue({
          text: 'Please enter text:',
          onText: onTextHandler,
        }),
      };

      const router = createRouter([inputRoute], [], {
        stateStore,
        inputPrompt: 'Please enter text:',
      });
      router.run(bot, {});

      const ctx = {
        chat: { id: 1 },
        from: { id: 1 },
        reply: vi.fn().mockResolvedValue({ message_id: 100 }),
        answerCbQuery: vi.fn(),
      };

      // Start input flow
      const cmd = vi
        .mocked(bot.command)
        .mock.calls.find((c) => c[0] === 'input')?.[1];
      await cmd!(ctx);

      // Check that awaiting state is set
      const stateAfterPrompt = await stateStore.get(1, 1);
      expect(stateAfterPrompt?.awaitingTextRouteId).toBe('input');

      // Simulate text input
      const textHandler = vi
        .mocked(bot.on)
        .mock.calls.find((c) => c[0] === 'text')?.[1];
      const textCtx = { ...ctx, message: { text: 'user input' } };
      await textHandler!(textCtx, vi.fn());

      expect(onTextHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'user input',
        })
      );

      // Check that awaiting state is cleared
      const stateAfterText = await stateStore.get(1, 1);
      expect(stateAfterText?.awaitingTextRouteId).toBeUndefined();
    });

    it('handles cancel during text input', async () => {
      const inputRoute: Route = {
        id: 'input',
        actionName: 'input',
        action: vi.fn().mockResolvedValue(undefined),
        onText: vi.fn(),
      };

      const router = createRouter([inputRoute], [], {
        stateStore,
        cancelCommands: ['/cancel'],
      });
      router.run(bot, {});

      const ctx = {
        chat: { id: 1 },
        from: { id: 1 },
        reply: vi.fn().mockResolvedValue({ message_id: 100 }),
        answerCbQuery: vi.fn(),
        editMessageReplyMarkup: vi.fn(),
      };

      // Start input
      const cmd = vi
        .mocked(bot.command)
        .mock.calls.find((c) => c[0] === 'input')?.[1];
      await cmd!(ctx);

      // Cancel with command
      const textHandler = vi
        .mocked(bot.on)
        .mock.calls.find((c) => c[0] === 'text')?.[1];
      const cancelCtx = { ...ctx, message: { text: '/cancel' } };
      await textHandler!(cancelCtx, vi.fn());

      // onText should not be called, awaiting state should be cleared
      expect(inputRoute.onText).not.toHaveBeenCalled();
      const state = await stateStore.get(1, 1);
      expect(state?.awaitingTextRouteId).toBeUndefined();
    });
  });

  describe('Button Action Handling', () => {
    it('executes button actions and handles navigation', async () => {
      const buttonAction = vi.fn();
      const targetRoute: Route = {
        id: 'target',
        action: vi.fn().mockResolvedValue({ text: 'Target reached' }),
      };

      const mainRoute: Route = {
        id: 'main',
        actionName: 'start',
        action: vi.fn().mockResolvedValue({
          text: 'Main Menu',
          buttons: DSL.rows([
            {
              text: 'Action Button',
              callback: 'action_btn',
              action: buttonAction,
            },
            {
              text: 'Navigate',
              callback: cb('target'),
            },
          ]),
        }),
      };

      const router = createRouter([mainRoute, targetRoute], [], { stateStore });
      router.run(bot, {});

      const ctx = {
        chat: { id: 1 },
        from: { id: 1 },
        reply: vi.fn().mockResolvedValue({ message_id: 100 }),
        answerCbQuery: vi.fn(),
        editMessageText: vi.fn(),
      };

      // Render initial view
      const cmd = vi
        .mocked(bot.command)
        .mock.calls.find((c) => c[0] === 'start')?.[1];
      await cmd!(ctx);

      // Test button action
      const actionHandler = vi.mocked(bot.action).mock.calls.at(-1)?.[1];
      await actionHandler!({
        ...ctx,
        callbackQuery: { data: 'action_btn', message: { message_id: 100 } },
      });

      expect(buttonAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actions: expect.any(Object),
          navigate: expect.any(Function),
          navigateBack: expect.any(Function),
        })
      );

      // Test navigation via callback
      await actionHandler!({
        ...ctx,
        callbackQuery: { data: 'target!v1', message: { message_id: 100 } },
      });

      expect(targetRoute.action).toHaveBeenCalled();
      const state = await stateStore.get(1, 1);
      expect(state?.stack).toContain('target');
    });
  });

  describe('Error Handling', () => {
    it('handles RouterUserError with custom view', async () => {
      const errorRoute: Route = {
        id: 'error',
        actionName: 'error',
        action: vi.fn().mockImplementation(() => {
          throw new RouterUserError('Custom error', {
            text: 'Something went wrong',
            renderMode: 'append',
          });
        }),
      };

      const router = createRouter([errorRoute], [], {
        stateStore,
        errorPrefix: 'ERROR: ',
      });
      router.run(bot, {});

      const ctx = {
        chat: { id: 1 },
        from: { id: 1 },
        reply: vi.fn().mockResolvedValue({ message_id: 100 }),
        answerCbQuery: vi.fn(),
      };

      const cmd = vi
        .mocked(bot.command)
        .mock.calls.find((c) => c[0] === 'error')?.[1];
      await cmd!(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        'Something went wrong',
        expect.any(Object)
      );
    });

    it('handles generic errors with default message', async () => {
      const errorRoute: Route = {
        id: 'error',
        actionName: 'error',
        action: vi.fn().mockImplementation(() => {
          throw new Error('Generic error');
        }),
      };

      const router = createRouter([errorRoute], [], {
        stateStore,
        errorPrefix: 'ERR: ',
        errorDefaultText: 'Something went wrong',
      });
      router.run(bot, {});

      const ctx = {
        chat: { id: 1 },
        from: { id: 1 },
        reply: vi.fn().mockResolvedValue({ message_id: 100 }),
        answerCbQuery: vi.fn(),
      };

      const cmd = vi
        .mocked(bot.command)
        .mock.calls.find((c) => c[0] === 'error')?.[1];
      await cmd!(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        'ERR: Something went wrong',
        expect.any(Object)
      );
    });
  });

  describe('Token Store Integration', () => {
    it('handles token expiration correctly', () => {
      const tokenStore = new InMemoryTokenStore();

      // Save token with 10ms TTL
      const token = tokenStore.save({ data: 'test' }, 10);

      // Immediate access should work
      expect(tokenStore.load(token)).toEqual({ data: 'test' });

      // After timeout, should return undefined
      return new Promise((resolve) => {
        setTimeout(() => {
          expect(tokenStore.load(token)).toBeUndefined();
          resolve(undefined);
        }, 20);
      });
    });
  });

  describe('Message Management', () => {
    it('tracks and prunes messages correctly', async () => {
      const route: Route = {
        id: 'test',
        actionName: 'test',
        action: vi
          .fn()
          .mockResolvedValue({ text: 'Test', renderMode: 'append' }),
      };

      const router = createRouter([route], [], {
        stateStore,
        maxMessages: 2, // Small limit for testing
      });
      router.run(bot, {});

      const ctx = {
        chat: { id: 1 },
        from: { id: 1 },
        reply: vi
          .fn()
          .mockImplementation(() => ({ message_id: Math.random() * 1000 })),
        answerCbQuery: vi.fn(),
        deleteMessage: vi.fn(),
      };

      const cmd = vi
        .mocked(bot.command)
        .mock.calls.find((c) => c[0] === 'test')?.[1];

      // Create 3 messages (should trigger pruning)
      await cmd!(ctx);
      await cmd!(ctx);
      await cmd!(ctx);

      // Should have attempted to delete the oldest message
      expect(ctx.deleteMessage).toHaveBeenCalled();

      const state = await stateStore.get(1, 1);
      expect(state?.messages.length).toBeLessThanOrEqual(2);
    });
  });
});
