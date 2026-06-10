import type { Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { DefaultDialogueManager } from '../src/application/use-cases/chat/DefaultDialogueManager';
import type { DialogueManager } from '../src/application/interfaces/chat/DialogueManager';
import { DefaultTriggerPipeline } from '../src/application/use-cases/chat/DefaultTriggerPipeline';
import type { TriggerPipeline } from '../src/application/interfaces/chat/TriggerPipeline';
import type { Trigger, TriggerContext } from '../src/domain/triggers/Trigger';
import { MentionTrigger } from '../src/view/telegram/triggers/MentionTrigger';
import { ReplyTrigger } from '../src/view/telegram/triggers/ReplyTrigger';
import { NameTrigger } from '../src/view/telegram/triggers/NameTrigger';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { EnvService } from '../src/application/interfaces/env/EnvService';

describe('TriggerPipeline', () => {
  const env = {
    getBotName: () => 'bot',
    getDialogueTimeoutMs: () => 0,
  } as unknown as EnvService;
  const loggerFactory: LoggerFactory = {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  } as unknown as LoggerFactory;

  const createPipeline = (
    logger: LoggerFactory = loggerFactory,
    triggers?: (dialogue: DialogueManager) => Trigger[]
  ): { pipeline: TriggerPipeline; dialogue: DialogueManager } => {
    const dialogue: DialogueManager = new DefaultDialogueManager(env, logger);
    const defaultTriggers: Trigger[] = triggers?.(dialogue) ?? [
      new MentionTrigger(dialogue, logger),
      new ReplyTrigger(logger),
      new NameTrigger(env, logger),
    ];
    const pipeline = new DefaultTriggerPipeline(
      dialogue,
      defaultTriggers,
      logger
    );
    return { pipeline, dialogue };
  };

  it('returns result when mention trigger matches', async () => {
    const { pipeline } = createPipeline();
    const ctx = {
      message: { text: 'hi @bot' },
      me: { username: 'bot' },
    } as unknown as Context;
    const context: TriggerContext = {
      text: 'hi @bot',
      replyText: '',
      chatId: 1,
    };
    const res = await pipeline.shouldRespond(ctx, context);
    expect(res).not.toBeNull();
  });

  it('exits early when a trigger matches', async () => {
    const secondTrigger = { apply: vi.fn().mockResolvedValue(null) };
    const { pipeline } = createPipeline(loggerFactory, () => [
      {
        apply: vi
          .fn()
          .mockResolvedValue({ replyToMessageId: null, reason: null }),
      },
      secondTrigger,
    ]);
    const ctx = {
      message: { text: 'hi @bot' },
      me: { username: 'bot' },
    } as unknown as Context;
    const context: TriggerContext = {
      text: 'hi @bot',
      replyText: '',
      chatId: 1,
    };
    const res = await pipeline.shouldRespond(ctx, context);
    expect(res).not.toBeNull();
    expect(secondTrigger.apply).not.toHaveBeenCalled();
  });

  it('returns null for non-direct messages so behavior gate can batch them', async () => {
    const { pipeline } = createPipeline();
    const ctx = {
      message: { text: 'hello there' },
      me: { username: 'bot' },
    } as unknown as Context;
    const context: TriggerContext = {
      text: 'hello there',
      replyText: '',
      chatId: 1,
    };

    const res = await pipeline.shouldRespond(ctx, context);
    expect(res).toBeNull();
  });

  it('does not extend dialogue timer when no triggers match', async () => {
    const { pipeline, dialogue } = createPipeline();
    const ctx = {
      message: { text: 'hello there' },
      me: { username: 'bot' },
    } as unknown as Context;
    const context: TriggerContext = {
      text: 'hello there',
      replyText: '',
      chatId: 1,
    };
    dialogue.start(1);
    const extendSpy = vi.spyOn(dialogue, 'extend');
    const res = await pipeline.shouldRespond(ctx, context);
    expect(res).toBeNull();
    expect(extendSpy).not.toHaveBeenCalled();
  });

  it('logs which trigger fired when a trigger matches', async () => {
    const pipelineLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };
    const otherLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };
    const customLoggerFactory: LoggerFactory = {
      create: vi.fn((name: string) =>
        name === 'DefaultTriggerPipeline' ? pipelineLogger : otherLogger
      ),
    } as unknown as LoggerFactory;
    const { pipeline } = createPipeline(customLoggerFactory);
    const ctx = {
      message: { text: 'hi @bot' },
      me: { username: 'bot' },
    } as unknown as Context;
    const context: TriggerContext = {
      text: 'hi @bot',
      replyText: '',
      chatId: 1,
    };
    await pipeline.shouldRespond(ctx, context);
    expect(pipelineLogger.debug).toHaveBeenCalledWith(
      { chatId: 1, trigger: 'MentionTrigger' },
      'Trigger matched'
    );
  });

  it('logs when no triggers match', async () => {
    const pipelineLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };
    const otherLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };
    const customLoggerFactory: LoggerFactory = {
      create: vi.fn((name: string) =>
        name === 'DefaultTriggerPipeline' ? pipelineLogger : otherLogger
      ),
    } as unknown as LoggerFactory;
    const { pipeline } = createPipeline(customLoggerFactory);
    const ctx = {
      message: { text: 'hello there' },
      me: { username: 'bot' },
    } as unknown as Context;
    const context: TriggerContext = {
      text: 'hello there',
      replyText: '',
      chatId: 1,
    };
    await pipeline.shouldRespond(ctx, context);
    expect(pipelineLogger.debug).toHaveBeenCalledWith(
      { chatId: 1 },
      'No trigger matched'
    );
  });
});
