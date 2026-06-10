import type { Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { DefaultDialogueManager } from '../src/application/use-cases/chat/DefaultDialogueManager';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { MentionTrigger } from '../src/view/telegram/triggers/MentionTrigger';
import { NameTrigger } from '../src/view/telegram/triggers/NameTrigger';
import { ReplyTrigger } from '../src/view/telegram/triggers/ReplyTrigger';
import { TriggerContext } from '../src/domain/triggers/Trigger';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { EnvService } from '../src/application/interfaces/env/EnvService';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  }) as unknown as LoggerFactory;

describe('MentionTrigger', () => {
  const createMentionTrigger = (loggerFactory = createLoggerFactory()) => {
    const dialogue = new DefaultDialogueManager(
      new TestEnvService(),
      createLoggerFactory()
    );
    const trigger = new MentionTrigger(dialogue, loggerFactory);
    return { trigger, dialogue };
  };

  it('removes bot mention and returns result', async () => {
    const { trigger } = createMentionTrigger();
    const ctx: TriggerContext = { text: '', replyText: '', chatId: 1 };
    const telegrafCtx = {
      message: { text: 'hello @bot' },
      me: { username: 'bot' },
    } as unknown as Context;
    const res = await trigger.apply(telegrafCtx, ctx);
    expect(res).not.toBeNull();
    expect(res?.replyToMessageId).toBeNull();
    expect(res?.reason).toBeNull();
    expect(ctx.text).toBe('hello');
  });

  it('returns null without mention', async () => {
    const { trigger } = createMentionTrigger();
    const ctx: TriggerContext = { text: '', replyText: '', chatId: 1 };
    const telegrafCtx = {
      message: { text: 'hello there' },
      me: { username: 'bot' },
    } as unknown as Context;
    const res = await trigger.apply(telegrafCtx, ctx);
    expect(res).toBeNull();
    expect(ctx.text).toBe('');
  });

  it('handles non-string fields gracefully', async () => {
    const { trigger } = createMentionTrigger();
    const ctx: TriggerContext = { text: '', replyText: '', chatId: 1 };
    const telegrafCtx = { message: {}, me: undefined } as unknown as Context;
    const res = await trigger.apply(telegrafCtx, ctx);
    expect(res).toBeNull();
    expect(ctx.text).toBe('');
  });

  it('logs snippet and dialogue state', async () => {
    const debug = vi.fn();
    const loggerFactory = {
      create: () => ({
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    } as unknown as LoggerFactory;
    const { trigger: triggerWithLogger, dialogue } =
      createMentionTrigger(loggerFactory);
    const ctx: TriggerContext = { text: '', replyText: '', chatId: 1 };
    const telegrafCtx = {
      message: { text: 'hello there @bot how are you doing?' },
      me: { username: 'bot' },
    } as unknown as Context;
    dialogue.start(1);
    await triggerWithLogger.apply(telegrafCtx, ctx);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        snippet: expect.stringContaining('@bot'),
        dialogueState: 'active',
      }),
      'Mention trigger matched'
    );
  });
});

describe('NameTrigger', () => {
  const envService = {
    getBotName: () => 'Arkadius',
  } as unknown as EnvService;
  const trigger = new NameTrigger(envService, createLoggerFactory());

  it('recognizes name at start of text', async () => {
    const ctx: TriggerContext = {
      text: 'Arkadius, how are you?',
      replyText: '',
      chatId: 1,
    };
    const res = await trigger.apply({} as unknown as Context, ctx);
    expect(res).not.toBeNull();
    expect(ctx.text).toBe('how are you?');
  });

  it('returns null when name missing', async () => {
    const ctx: TriggerContext = {
      text: 'Hello Arkadius',
      replyText: '',
      chatId: 1,
    };
    const res = await trigger.apply({} as unknown as Context, ctx);
    expect(res).toBeNull();
    expect(ctx.text).toBe('Hello Arkadius');
  });
});

describe('ReplyTrigger', () => {
  const trigger = new ReplyTrigger(createLoggerFactory());

  it('matches when message replies to bot', async () => {
    const ctx: TriggerContext = { text: '', replyText: '', chatId: 1 };
    const telegrafCtx = {
      me: { username: 'bot' },
      message: { reply_to_message: { from: { username: 'bot' } } },
    } as unknown as Context;
    const res = await trigger.apply(telegrafCtx, ctx);
    expect(res).not.toBeNull();
  });

  it('returns null when not replying to bot', async () => {
    const ctx: TriggerContext = { text: '', replyText: '', chatId: 1 };
    const telegrafCtx = {
      me: { username: 'bot' },
      message: {},
    } as unknown as Context;
    const res = await trigger.apply(telegrafCtx, ctx);
    expect(res).toBeNull();
  });
});
