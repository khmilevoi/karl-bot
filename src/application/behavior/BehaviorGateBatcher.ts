import type { Logger } from '@/application/interfaces/logging/Logger';
import type { LoggerFactory } from '@/application/interfaces/logging/LoggerFactory';

import type { BehaviorPipelineConfig } from './BehaviorConfig';
import type { StoredBehaviorMessage } from './BehaviorTypes';

export type BatchFlushReason = 'size_cap' | 'hard_cap' | 'idle_gap';

export interface BehaviorGateBatch {
  chatId: number;
  messages: StoredBehaviorMessage[];
  flushReason: BatchFlushReason;
}

type FlushHandler = (batch: BehaviorGateBatch) => void | Promise<void>;

interface ChatBatch {
  messages: StoredBehaviorMessage[];
  firstAddedAt: number;
  lastAddedAt: number;
  hardTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export class BehaviorGateBatcher {
  private readonly batches = new Map<number, ChatBatch>();
  private readonly logger: Logger;

  constructor(
    private readonly config: BehaviorPipelineConfig,
    private readonly onTimerFlush: FlushHandler,
    loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('BehaviorGateBatcher');
  }

  add(message: StoredBehaviorMessage): BehaviorGateBatch | null {
    const { chatId } = message;
    const now = Date.now();

    let entry = this.batches.get(chatId);
    if (!entry) {
      entry = {
        messages: [],
        firstAddedAt: now,
        lastAddedAt: now,
        hardTimer: null,
        idleTimer: null,
      };
      this.batches.set(chatId, entry);

      entry.hardTimer = setTimeout(() => {
        this.flush(chatId, 'hard_cap');
      }, this.config.batchHardCapMs);
    }

    entry.messages.push(message);
    entry.lastAddedAt = now;

    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
    }
    entry.idleTimer = setTimeout(() => {
      this.flush(chatId, 'idle_gap');
    }, this.config.batchIdleGapMs);

    if (entry.messages.length >= this.config.batchSizeCap) {
      return this.extractBatch(chatId, 'size_cap');
    }

    return null;
  }

  drainForDirectTrigger(chatId: number): StoredBehaviorMessage[] {
    const entry = this.batches.get(chatId);
    if (!entry) {
      return [];
    }
    this.clearTimers(entry);
    this.batches.delete(chatId);
    const all = entry.messages;
    return all.slice(-this.config.maxDirectContextMessages);
  }

  private flush(chatId: number, reason: BatchFlushReason): void {
    const batch = this.extractBatch(chatId, reason);
    if (!batch) {
      return;
    }
    void Promise.resolve(this.onTimerFlush(batch)).catch((error: unknown) => {
      this.logger.error({ error, chatId }, 'Behavior gate batch flush failed');
    });
  }

  private extractBatch(
    chatId: number,
    reason: BatchFlushReason
  ): BehaviorGateBatch | null {
    const entry = this.batches.get(chatId);
    if (!entry) {
      return null;
    }
    this.clearTimers(entry);
    this.batches.delete(chatId);
    return { chatId, messages: entry.messages, flushReason: reason };
  }

  private clearTimers(entry: ChatBatch): void {
    if (entry.hardTimer !== null) {
      clearTimeout(entry.hardTimer);
      entry.hardTimer = null;
    }
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }
}
