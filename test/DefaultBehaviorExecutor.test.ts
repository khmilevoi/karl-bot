import { describe, expect, it, vi } from 'vitest';

import { DefaultBehaviorExecutor } from '../src/application/behavior/DefaultBehaviorExecutor';
import type { BehaviorRateLimiter } from '../src/application/behavior/BehaviorRateLimiter';
import type { BehaviorSummarizationQueue } from '../src/application/behavior/BehaviorSummarizationQueue';
import type { BehaviorDecisionContext } from '../src/application/behavior/BehaviorTypes';
import type { ChatMessenger } from '../src/application/interfaces/chat/ChatMessenger';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { MessageService } from '../src/application/interfaces/messages/MessageService';
import type { BehaviorAction } from '../src/domain/behavior/schemas/actions';

function makeContext(): BehaviorDecisionContext {
  return {
    chatId: -100,
    gate: {
      shouldDecide: true,
      confidence: 1,
      reason: 'direct_trigger',
      triggerMessageIds: [161],
      contextMessageIds: [],
      stateImpactRisk: 'low',
    },
    summary: '',
    messages: [
      { id: 161, chatId: -100, role: 'user', content: 'hi', messageId: 33538 },
    ],
    triggerMessageIds: [161],
    contextMessageIds: [],
    batchMessageIds: [161],
    state: {
      personality: {} as never,
      political: {} as never,
      profiles: [],
      truths: [],
      userPolitical: [],
    },
  };
}

const loggerFactory: LoggerFactory = {
  create: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
} as unknown as LoggerFactory;

const rateLimiter: BehaviorRateLimiter = {
  checkAction: () => ({ allowed: true, reason: null }),
  checkPatch: () => ({ allowed: true, reason: null }),
} as unknown as BehaviorRateLimiter;

const summarizationQueue = {
  enqueueOrBump: () => ({ outcome: 'queued' }),
} as unknown as BehaviorSummarizationQueue;

const replyAction: BehaviorAction = {
  type: 'reply',
  intent: 'banter',
  text: 'мой ответ',
  target: { kind: 'message', selector: { scope: 'trigger', pick: 'latest' } },
};

describe('DefaultBehaviorExecutor assistant persistence', () => {
  it('persists the assistant reply after a successful send', async () => {
    const addMessage = vi.fn().mockResolvedValue(999);
    const messages: MessageService = {
      addMessage,
    } as unknown as MessageService;
    const messenger: ChatMessenger = {
      sendMessage: vi.fn().mockResolvedValue(55501),
      bot: { botInfo: { id: 42, username: 'assistant_bot' } },
    } as unknown as ChatMessenger;

    const executor = new DefaultBehaviorExecutor(
      messenger,
      rateLimiter,
      summarizationQueue,
      messages,
      loggerFactory
    );

    const results = await executor.execute({
      context: makeContext(),
      actions: [replyAction],
    });

    expect(results[0].outcome).toBe('sent');
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: 'мой ответ',
        chatId: -100,
        messageId: 55501,
        userId: 42,
        username: 'assistant_bot',
      })
    );
  });

  it('does not persist when the send fails', async () => {
    const addMessage = vi.fn();
    const messages: MessageService = {
      addMessage,
    } as unknown as MessageService;
    const messenger: ChatMessenger = {
      sendMessage: vi.fn().mockRejectedValue(new Error('telegram down')),
      bot: { botInfo: { id: 42, username: 'assistant_bot' } },
    } as unknown as ChatMessenger;

    const executor = new DefaultBehaviorExecutor(
      messenger,
      rateLimiter,
      summarizationQueue,
      messages,
      loggerFactory
    );

    const results = await executor.execute({
      context: makeContext(),
      actions: [replyAction],
    });

    expect(results[0].outcome).toBe('failed');
    expect(addMessage).not.toHaveBeenCalled();
  });
});
