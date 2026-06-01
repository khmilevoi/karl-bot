import { describe, expect, it, vi } from 'vitest';

import { DefaultManualJobRunner } from '../src/application/use-cases/scheduler/DefaultManualJobRunner';
import type { StateEvolutionRunResult } from '../src/application/behavior/StateEvolutionPass';

describe('DefaultManualJobRunner', () => {
  it('runs topic-of-day immediately for the requested chat', async () => {
    const topicScheduler = { runNow: vi.fn(async () => {}) };
    const stateEvolutionPass = { run: vi.fn() };
    const runner = new DefaultManualJobRunner(
      topicScheduler as any,
      stateEvolutionPass as any
    );

    const result = await runner.run({ job: 'topic-of-day', chatId: 123 });

    expect(topicScheduler.runNow).toHaveBeenCalledWith(123);
    expect(stateEvolutionPass.run).not.toHaveBeenCalled();
    expect(result).toEqual({
      job: 'topic-of-day',
      chatId: 123,
      outcome: 'completed',
    });
  });

  it('runs state evolution immediately and returns its result', async () => {
    const stateResult: StateEvolutionRunResult = {
      kind: 'evolved',
      behaviorEventId: 77,
      patchResults: [],
    };
    const topicScheduler = { runNow: vi.fn() };
    const stateEvolutionPass = { run: vi.fn(async () => stateResult) };
    const runner = new DefaultManualJobRunner(
      topicScheduler as any,
      stateEvolutionPass as any
    );

    const result = await runner.run({ job: 'state-evolution', chatId: -456 });

    expect(stateEvolutionPass.run).toHaveBeenCalledWith(-456);
    expect(topicScheduler.runNow).not.toHaveBeenCalled();
    expect(result).toEqual({
      job: 'state-evolution',
      chatId: -456,
      outcome: 'evolved',
      stateEvolution: stateResult,
    });
  });
});
