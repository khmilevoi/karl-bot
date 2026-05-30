import { describe, expect, it, vi } from 'vitest';

import { DefaultBehaviorExecutor } from '../src/application/behavior/DefaultBehaviorExecutor';
import type { BehaviorRateLimiter } from '../src/application/behavior/BehaviorRateLimiter';
import type { BehaviorSummarizationQueue } from '../src/application/behavior/BehaviorSummarizationQueue';
import type { BehaviorDecisionContext } from '../src/application/behavior/BehaviorTypes';
import type { ChatMessenger } from '../src/application/interfaces/chat/ChatMessenger';
import type { BehaviorAction } from '../src/domain/behavior/schemas/actions';

const allowingLimiter: BehaviorRateLimiter = {
  checkAction: vi.fn(() => ({ allowed: true })),
  checkPatch: vi.fn(() => ({ allowed: true })),
};

function makeMessenger(overrides?: Partial<ChatMessenger>): ChatMessenger {
  return {
    bot: {} as ChatMessenger['bot'],
    sendMessage: vi.fn().mockResolvedValue(undefined),
    reactToMessage: vi.fn().mockResolvedValue(undefined),
    launch: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

function makeQueue(
  outcome: 'queued' | 'bumped' | 'deferred' = 'queued'
): BehaviorSummarizationQueue {
  return {
    enqueueOrBump: vi.fn(() =>
      outcome === 'deferred'
        ? { outcome, reason: 'summarization queue disabled' }
        : { outcome }
    ),
  };
}

function makeContext(): BehaviorDecisionContext {
  return {
    chatId: 1,
    gate: {
      shouldDecide: true,
      confidence: 0.9,
      reason: 'conflict',
      triggerMessageIds: [1],
      contextMessageIds: [2],
      stateImpactRisk: 'medium',
    },
    summary: '',
    triggerMessageIds: [1],
    contextMessageIds: [2],
    batchMessageIds: [3, 4],
    messages: [
      {
        id: 1,
        chatId: 1,
        role: 'user',
        content: 'trigger',
        messageId: 101,
      },
      { id: 2, chatId: 1, role: 'user', content: 'context' },
      { id: 3, chatId: 1, role: 'user', content: 'batch', messageId: 103 },
      { id: 4, chatId: 1, role: 'user', content: 'batch2', messageId: 104 },
    ],
    state: {
      personality: {} as BehaviorDecisionContext['state']['personality'],
      political: {} as BehaviorDecisionContext['state']['political'],
      profiles: [],
      truths: [],
    },
  };
}

describe('DefaultBehaviorExecutor', () => {
  it('sends reply and ask_question actions through ChatMessenger', async () => {
    const messenger = makeMessenger();
    const executor = new DefaultBehaviorExecutor(
      messenger,
      allowingLimiter,
      makeQueue()
    );
    const actions: BehaviorAction[] = [
      {
        type: 'reply',
        intent: 'direct_answer',
        text: 'answer',
        target: {
          kind: 'message',
          selector: { scope: 'trigger', pick: 'latest', index: null },
        },
      },
      {
        type: 'ask_question',
        intent: 'clarify',
        text: 'what changed?',
        targetUsername: 'alice',
      },
    ];

    const results = await executor.execute({
      context: makeContext(),
      actions,
      nowMs: 1_000,
    });

    expect(messenger.sendMessage).toHaveBeenNthCalledWith(1, 1, 'answer', {
      reply_parameters: { message_id: 101 },
    });
    expect(messenger.sendMessage).toHaveBeenNthCalledWith(
      2,
      1,
      '@alice what changed?'
    );
    expect(results.map((result) => result.outcome)).toEqual(['sent', 'sent']);
  });

  it('reacts to selector targets and drops selected messages without Telegram ids', async () => {
    const messenger = makeMessenger();
    const executor = new DefaultBehaviorExecutor(
      messenger,
      allowingLimiter,
      makeQueue()
    );

    const results = await executor.execute({
      context: makeContext(),
      actions: [
        {
          type: 'react',
          intent: 'acknowledgement',
          emoji: '👍',
          target: { scope: 'context', pick: 'latest', index: null },
        },
        {
          type: 'react',
          intent: 'acknowledgement',
          emoji: '🔥',
          target: { scope: 'batch', pick: 'all', index: null },
        },
      ],
      nowMs: 1_000,
    });

    expect(messenger.reactToMessage).toHaveBeenNthCalledWith(1, 1, 103, '🔥');
    expect(messenger.reactToMessage).toHaveBeenNthCalledWith(2, 1, 104, '🔥');
    expect(results).toEqual([
      {
        actionType: 'react',
        outcome: 'dropped',
        reason: 'target message has no telegram id',
        targetMessageId: 2,
      },
      {
        actionType: 'react',
        outcome: 'sent',
        reason: null,
        targetMessageId: 3,
        telegramMessageId: 103,
      },
      {
        actionType: 'react',
        outcome: 'sent',
        reason: null,
        targetMessageId: 4,
        telegramMessageId: 104,
      },
    ]);
  });

  it('queues summarize_thread and returns no results for empty actions', async () => {
    const queue = makeQueue('bumped');
    const executor = new DefaultBehaviorExecutor(
      makeMessenger(),
      allowingLimiter,
      queue
    );

    await expect(
      executor.execute({ context: makeContext(), actions: [] })
    ).resolves.toEqual([]);

    const results = await executor.execute({
      context: makeContext(),
      actions: [
        {
          type: 'summarize_thread',
          intent: 'compress_context',
          reason: 'too long',
        },
      ],
    });

    expect(queue.enqueueOrBump).toHaveBeenCalledWith({
      chatId: 1,
      intent: 'compress_context',
      reason: 'too long',
      triggerMessageIds: [1],
      contextMessageIds: [2],
      batchMessageIds: [3, 4],
    });
    expect(results).toEqual([
      {
        actionType: 'summarize_thread',
        outcome: 'bumped',
        reason: null,
      },
    ]);
  });

  it('drops invalid selectors without calling Telegram', async () => {
    const messenger = makeMessenger();
    const executor = new DefaultBehaviorExecutor(
      messenger,
      allowingLimiter,
      makeQueue()
    );

    const results = await executor.execute({
      context: makeContext(),
      actions: [
        {
          type: 'reply',
          intent: 'direct_answer',
          text: 'answer',
          target: {
            kind: 'message',
            selector: { scope: 'context', pick: 'index', index: 5 },
          },
        },
      ],
    });

    expect(messenger.sendMessage).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        actionType: 'reply',
        outcome: 'dropped',
        reason: 'selector resolved no messages',
      },
    ]);
  });

  it('records Telegram failures as failed action results', async () => {
    const messenger = makeMessenger({
      sendMessage: vi.fn().mockRejectedValue(new Error('telegram down')),
    });
    const executor = new DefaultBehaviorExecutor(
      messenger,
      allowingLimiter,
      makeQueue()
    );

    const results = await executor.execute({
      context: makeContext(),
      actions: [
        {
          type: 'reply',
          intent: 'direct_answer',
          text: 'answer',
          target: { kind: 'none' },
        },
      ],
    });

    expect(results).toEqual([
      {
        actionType: 'reply',
        outcome: 'failed',
        reason: 'telegram down',
      },
    ]);
  });

  it('drops rate-limited actions before Telegram or queue work', async () => {
    const messenger = makeMessenger();
    const queue = makeQueue();
    const limiter: BehaviorRateLimiter = {
      checkAction: vi.fn(() => ({
        allowed: false,
        reason: 'initiative rate limit exceeded',
      })),
      checkPatch: vi.fn(() => ({ allowed: true })),
    };
    const executor = new DefaultBehaviorExecutor(messenger, limiter, queue);

    const results = await executor.execute({
      context: makeContext(),
      actions: [
        {
          type: 'ask_question',
          intent: 'clarify',
          text: 'what changed?',
          targetUsername: null,
        },
      ],
    });

    expect(messenger.sendMessage).not.toHaveBeenCalled();
    expect(queue.enqueueOrBump).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        actionType: 'ask_question',
        outcome: 'rate_limited',
        reason: 'initiative rate limit exceeded',
      },
    ]);
  });
});
