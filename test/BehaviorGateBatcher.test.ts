import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { BehaviorGateBatcher } from '../src/application/behavior/BehaviorGateBatcher';
import type { BehaviorPipelineConfig } from '../src/application/behavior/BehaviorConfig';
import type { StoredBehaviorMessage } from '../src/application/behavior/BehaviorTypes';

const config: BehaviorPipelineConfig = {
  batchSizeCap: 3,
  batchHardCapMs: 30_000,
  batchIdleGapMs: 5_000,
  maxDirectContextMessages: 2,
  recentHistoryLimit: 80,
  minDecisionConfidence: 0.45,
};

function createLoggerFactory(): LoggerFactory {
  return {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  } as unknown as LoggerFactory;
}

function makeMsg(id: number, chatId = 1): StoredBehaviorMessage {
  return {
    id,
    chatId,
    role: 'user',
    content: `msg ${id}`,
  } as StoredBehaviorMessage;
}

describe('BehaviorGateBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns null for messages below size cap', () => {
    const onFlush = vi.fn();
    const batcher = new BehaviorGateBatcher(
      config,
      onFlush,
      createLoggerFactory()
    );

    expect(batcher.add(makeMsg(1))).toBeNull();
    expect(batcher.add(makeMsg(2))).toBeNull();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('flushes synchronously when size cap is reached', () => {
    const onFlush = vi.fn();
    const batcher = new BehaviorGateBatcher(
      config,
      onFlush,
      createLoggerFactory()
    );

    batcher.add(makeMsg(1));
    batcher.add(makeMsg(2));
    const batch = batcher.add(makeMsg(3));

    expect(batch).not.toBeNull();
    expect(batch?.flushReason).toBe('size_cap');
    expect(batch?.messages).toHaveLength(3);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('flushes via timer on idle gap', async () => {
    const onFlush = vi.fn();
    const batcher = new BehaviorGateBatcher(
      config,
      onFlush,
      createLoggerFactory()
    );

    batcher.add(makeMsg(1));
    batcher.add(makeMsg(2));
    await vi.advanceTimersByTimeAsync(config.batchIdleGapMs);

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 1, flushReason: 'idle_gap' })
    );
  });

  it('flushes via hard cap timer even with continuous adds', async () => {
    const onFlush = vi.fn();
    const largeCap = { ...config, batchSizeCap: 100 };
    const batcher = new BehaviorGateBatcher(
      largeCap,
      onFlush,
      createLoggerFactory()
    );

    batcher.add(makeMsg(1));
    // advance just before each idle gap to keep resetting it
    for (let t = 0; t < config.batchHardCapMs; t += config.batchIdleGapMs - 1) {
      await vi.advanceTimersByTimeAsync(config.batchIdleGapMs - 1);
      if (t + config.batchIdleGapMs - 1 < config.batchHardCapMs) {
        batcher.add(makeMsg(t + 2, 1));
      }
    }
    // advance past hard cap
    await vi.advanceTimersByTimeAsync(config.batchHardCapMs);

    expect(onFlush).toHaveBeenCalledWith(
      expect.objectContaining({ flushReason: 'hard_cap' })
    );
  });

  it('drains for direct trigger, capped to maxDirectContextMessages', () => {
    const onFlush = vi.fn();
    // Use a larger size cap so batch is not flushed synchronously
    const largeCap = { ...config, batchSizeCap: 10 };
    const batcher = new BehaviorGateBatcher(
      largeCap,
      onFlush,
      createLoggerFactory()
    );

    batcher.add(makeMsg(1));
    batcher.add(makeMsg(2));
    batcher.add(makeMsg(3));

    const drained = batcher.drainForDirectTrigger(1);
    expect(drained).toHaveLength(config.maxDirectContextMessages);
    expect(drained.map((m) => m.id)).toEqual([2, 3]);
  });

  it('drainForDirectTrigger returns empty array for unknown chat', () => {
    const onFlush = vi.fn();
    const batcher = new BehaviorGateBatcher(
      config,
      onFlush,
      createLoggerFactory()
    );

    expect(batcher.drainForDirectTrigger(99)).toEqual([]);
  });

  it('chats are independent — different chat ids do not interfere', () => {
    const onFlush = vi.fn();
    const batcher = new BehaviorGateBatcher(
      config,
      onFlush,
      createLoggerFactory()
    );

    batcher.add(makeMsg(1, 1));
    batcher.add(makeMsg(2, 2));

    const drained1 = batcher.drainForDirectTrigger(1);
    expect(drained1.map((m) => m.chatId)).toEqual([1]);

    const drained2 = batcher.drainForDirectTrigger(2);
    expect(drained2.map((m) => m.chatId)).toEqual([2]);
  });
});
