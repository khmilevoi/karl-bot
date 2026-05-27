import type { Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import { DefaultDialogueManager } from '../src/application/use-cases/chat/DefaultDialogueManager';
import type { DialogueManager } from '../src/application/interfaces/chat/DialogueManager';
import { InterestChecker } from '../src/application/interfaces/interest/InterestChecker';
import { InterestTrigger } from '../src/view/telegram/triggers/InterestTrigger';
import { TriggerContext } from '../src/domain/triggers/Trigger';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

class MockInterestChecker implements InterestChecker {
  public calls = 0;
  constructor(
    private readonly n: number,
    private readonly result: {
      messageId: string;
      message: string;
      why: string;
    } | null
  ) {}

  async check(): Promise<{
    messageId: string;
    message: string;
    why: string;
  } | null> {
    this.calls += 1;
    if (this.calls < this.n) {
      return null;
    }
    return this.result;
  }
}

describe('InterestTrigger', () => {
  const loggerFactory: LoggerFactory = {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  } as unknown as LoggerFactory;
  const dialogue: DialogueManager = new DefaultDialogueManager(
    { getDialogueTimeoutMs: () => 0 } as any,
    loggerFactory
  );
  const baseCtx: TriggerContext = { text: '', replyText: '', chatId: 1 };

  it('returns null when message count is below threshold', async () => {
    const trigger = new InterestTrigger(
      new MockInterestChecker(3, {
        messageId: '1',
        message: 'hi',
        why: 'because',
      }),
      dialogue,
      loggerFactory
    );
    const res = await trigger.apply({} as unknown as Context, baseCtx);
    expect(res).toBeNull();
  });

  it('returns result when threshold met and interested', async () => {
    const trigger = new InterestTrigger(
      new MockInterestChecker(2, {
        messageId: '1',
        message: 'hi',
        why: 'because',
      }),
      dialogue,
      loggerFactory
    );
    await trigger.apply({} as unknown as Context, baseCtx);
    const res = await trigger.apply({} as unknown as Context, baseCtx);
    expect(res).not.toBeNull();
    expect(res?.replyToMessageId).toBe(1);
    expect(res?.reason?.why).toBe('because');
    expect(res?.reason?.message).toBe('hi');
  });

  it('returns null when checker reports not interested', async () => {
    const trigger = new InterestTrigger(
      new MockInterestChecker(2, null),
      dialogue,
      loggerFactory
    );
    await trigger.apply({} as unknown as Context, baseCtx);
    const res = await trigger.apply({} as unknown as Context, baseCtx);
    expect(res).toBeNull();
  });

  it('skips interest check when dialogue is active', async () => {
    const checker = new MockInterestChecker(1, {
      messageId: '1',
      message: 'hi',
      why: 'because',
    });
    const activeDialogue: DialogueManager = new DefaultDialogueManager(
      { getDialogueTimeoutMs: () => 0 } as any,
      loggerFactory
    );
    const trigger = new InterestTrigger(checker, activeDialogue, loggerFactory);
    activeDialogue.start(baseCtx.chatId);
    const res = await trigger.apply({} as unknown as Context, baseCtx);
    expect(res).toBeNull();
    expect(checker.calls).toBe(0);
  });
});
