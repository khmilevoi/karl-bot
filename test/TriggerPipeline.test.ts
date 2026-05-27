import type { Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { DefaultDialogueManager } from '../src/application/use-cases/chat/DefaultDialogueManager';
import type { DialogueManager } from '../src/application/interfaces/chat/DialogueManager';
import { DefaultTriggerPipeline } from '../src/application/use-cases/chat/DefaultTriggerPipeline';
import type { TriggerPipeline } from '../src/application/interfaces/chat/TriggerPipeline';
import type { InterestChecker } from '../src/application/interfaces/interest/InterestChecker';
import type { Trigger, TriggerContext } from '../src/domain/triggers/Trigger';
import { MentionTrigger } from '../src/view/telegram/triggers/MentionTrigger';
import { ReplyTrigger } from '../src/view/telegram/triggers/ReplyTrigger';
import { NameTrigger } from '../src/view/telegram/triggers/NameTrigger';
import { InterestTrigger } from '../src/view/telegram/triggers/InterestTrigger';
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
    interestChecker: InterestChecker,
    logger: LoggerFactory = loggerFactory,
    triggers?: (dialogue: DialogueManager) => Trigger[]
  ): { pipeline: TriggerPipeline; dialogue: DialogueManager } => {
    const dialogue: DialogueManager = new DefaultDialogueManager(env, logger);
    const defaultTriggers: Trigger[] = triggers?.(dialogue) ?? [
      new MentionTrigger(dialogue, logger),
      new ReplyTrigger(logger),
      new NameTrigger(env, logger),
      new InterestTrigger(interestChecker, dialogue, logger),
    ];
    const pipeline = new DefaultTriggerPipeline(
      dialogue,
      defaultTriggers,
      logger
    );
    return { pipeline, dialogue };
  };

  it('returns result when mention trigger matches', async () => {
    const { pipeline } = createPipeline({
      async check() {
        return null;
      },
    });
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
    const interestChecker: InterestChecker = {
      check: vi.fn().mockResolvedValue(null),
    };
    const { pipeline } = createPipeline(interestChecker);
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
    expect(interestChecker.check).not.toHaveBeenCalled();
  });

  it('responds only when interest trigger returns result without mentions or replies', async () => {
    let result: { messageId: string; message: string; why: string } | null =
      null;
    const interestChecker: InterestChecker = {
      async check() {
        return result;
      },
    };
    const { pipeline } = createPipeline(interestChecker);
    const ctx = {
      message: { text: 'hello there' },
      me: { username: 'bot' },
    } as unknown as Context;
    const context: TriggerContext = {
      text: 'hello there',
      replyText: '',
      chatId: 1,
    };

    let res = await pipeline.shouldRespond(ctx, context);
    expect(res).toBeNull();

    result = { messageId: '1', message: 'hi', why: 'because' };
    res = await pipeline.shouldRespond(ctx, context);
    expect(res).not.toBeNull();
  });

  it('uses interest trigger when mention and reply triggers return null', async () => {
    const interestChecker: InterestChecker = {
      check: vi
        .fn()
        .mockResolvedValue({ messageId: '1', message: 'hi', why: 'because' }),
    };
    const { pipeline } = createPipeline(
      interestChecker,
      loggerFactory,
      (dialogue) => [
        { apply: vi.fn().mockResolvedValue(null) },
        { apply: vi.fn().mockResolvedValue(null) },
        new NameTrigger(env, loggerFactory),
        new InterestTrigger(interestChecker, dialogue, loggerFactory),
      ]
    );
    const ctx = {
      message: { text: 'hi @bot', reply_to_message: { message_id: 2 } },
      me: { username: 'bot' },
    } as unknown as Context;
    const context: TriggerContext = {
      text: 'hi @bot',
      replyText: 'original',
      chatId: 1,
    };
    const res = await pipeline.shouldRespond(ctx, context);
    expect(res).not.toBeNull();
    expect(interestChecker.check).toHaveBeenCalled();
  });

  it('propagates error when interest checker fails', async () => {
    const interestChecker: InterestChecker = {
      check: vi.fn().mockRejectedValue(new Error('fail')),
    };
    const { pipeline } = createPipeline(interestChecker);
    const ctx = {
      message: { text: 'hello there' },
      me: { username: 'bot' },
    } as unknown as Context;
    const context: TriggerContext = {
      text: 'hello there',
      replyText: '',
      chatId: 1,
    };
    await expect(pipeline.shouldRespond(ctx, context)).rejects.toThrow('fail');
  });

  it('skips interest trigger when dialogue is active', async () => {
    const interestChecker: InterestChecker = {
      check: vi.fn().mockResolvedValue({
        messageId: '1',
        message: 'hi',
        why: 'because',
      }),
    };
    const { pipeline, dialogue } = createPipeline(interestChecker);
    dialogue.start(1);
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
    expect(interestChecker.check).not.toHaveBeenCalled();
  });

  it('does not extend dialogue timer when no triggers match', async () => {
    const interestChecker: InterestChecker = {
      check: vi.fn().mockResolvedValue(null),
    };
    const { pipeline, dialogue } = createPipeline(interestChecker);
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
    const { pipeline } = createPipeline(
      { check: vi.fn().mockResolvedValue(null) },
      customLoggerFactory
    );
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
    const interestChecker: InterestChecker = {
      check: vi.fn().mockResolvedValue(null),
    };
    const { pipeline } = createPipeline(interestChecker, customLoggerFactory);
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
