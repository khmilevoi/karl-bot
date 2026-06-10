import type { ServiceIdentifier } from 'inversify';

import type { BehaviorAction } from '@/domain/behavior/schemas/actions';

export interface BehaviorSummarizationRequest {
  chatId: number;
  intent: Extract<BehaviorAction, { type: 'summarize_thread' }>['intent'];
  reason: string;
  triggerMessageIds: number[];
  contextMessageIds: number[];
  batchMessageIds: number[];
}

export type BehaviorSummarizationQueueResult =
  | {
      outcome: 'queued';
    }
  | {
      outcome: 'bumped';
    }
  | {
      outcome: 'deferred';
      reason: string;
    };

export interface BehaviorSummarizationQueue {
  enqueueOrBump(
    request: BehaviorSummarizationRequest
  ): BehaviorSummarizationQueueResult;
}

export const BEHAVIOR_SUMMARIZATION_QUEUE_ID = Symbol.for(
  'BehaviorSummarizationQueue'
) as ServiceIdentifier<BehaviorSummarizationQueue>;
