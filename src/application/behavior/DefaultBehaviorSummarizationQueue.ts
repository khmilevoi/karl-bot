import { inject, injectable } from 'inversify';

import {
  BEHAVIOR_SUMMARIZATION_QUEUE_CONFIG_ID,
  type BehaviorSummarizationQueueConfig,
} from './BehaviorConfig';
import type {
  BehaviorSummarizationQueue,
  BehaviorSummarizationQueueResult,
  BehaviorSummarizationRequest,
} from './BehaviorSummarizationQueue';

@injectable()
export class DefaultBehaviorSummarizationQueue
  implements BehaviorSummarizationQueue
{
  private readonly pendingByChat = new Map<
    number,
    BehaviorSummarizationRequest
  >();

  constructor(
    @inject(BEHAVIOR_SUMMARIZATION_QUEUE_CONFIG_ID)
    private readonly config: BehaviorSummarizationQueueConfig
  ) {}

  enqueueOrBump(
    request: BehaviorSummarizationRequest
  ): BehaviorSummarizationQueueResult {
    if (!this.config.enabled) {
      return {
        outcome: 'deferred',
        reason: 'summarization queue disabled',
      };
    }

    const hasPending = this.pendingByChat.has(request.chatId);
    this.pendingByChat.set(request.chatId, request);

    return { outcome: hasPending ? 'bumped' : 'queued' };
  }

  peek(chatId: number): BehaviorSummarizationRequest | null {
    return this.pendingByChat.get(chatId) ?? null;
  }
}
