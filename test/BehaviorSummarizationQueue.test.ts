import { describe, expect, it } from 'vitest';

import { DefaultBehaviorSummarizationQueue } from '../src/application/behavior/DefaultBehaviorSummarizationQueue';
import type { BehaviorSummarizationQueueConfig } from '../src/application/behavior/BehaviorConfig';

const enabledConfig: BehaviorSummarizationQueueConfig = {
  enabled: true,
};

function request(reason: string) {
  return {
    chatId: 1,
    intent: 'compress_context' as const,
    reason,
    triggerMessageIds: [1],
    contextMessageIds: [2],
    batchMessageIds: [3],
  };
}

describe('DefaultBehaviorSummarizationQueue', () => {
  it('queues the first summarize-thread request for a chat', () => {
    const queue = new DefaultBehaviorSummarizationQueue(enabledConfig);

    expect(queue.enqueueOrBump(request('first'))).toEqual({
      outcome: 'queued',
    });
  });

  it('bumps an existing pending request for the same chat', () => {
    const queue = new DefaultBehaviorSummarizationQueue(enabledConfig);

    expect(queue.enqueueOrBump(request('first'))).toEqual({
      outcome: 'queued',
    });
    expect(queue.enqueueOrBump(request('second'))).toEqual({
      outcome: 'bumped',
    });
    expect(queue.peek(1)?.reason).toBe('second');
  });

  it('defers requests when the queue is disabled', () => {
    const queue = new DefaultBehaviorSummarizationQueue({ enabled: false });

    expect(queue.enqueueOrBump(request('first'))).toEqual({
      outcome: 'deferred',
      reason: 'summarization queue disabled',
    });
    expect(queue.peek(1)).toBeNull();
  });
});
