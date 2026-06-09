import { describe, expect, it, vi } from 'vitest';

import { DefaultJobRunner } from '../src/application/use-cases/scheduler/DefaultJobRunner';
import type { StateEvolutionRunResult } from '../src/application/behavior/StateEvolutionPass';
import type { FactCheckRunResult } from '../src/application/fact-checking/FactCheckPipeline';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  }) as unknown as LoggerFactory;

function makeRunner(overrides?: {
  stateEvolution?: { run?: ReturnType<typeof vi.fn> };
  pipeline?: {
    runHourly?: ReturnType<typeof vi.fn>;
    runStats?: ReturnType<typeof vi.fn>;
  };
  approval?: { listAll?: ReturnType<typeof vi.fn> };
  scheduler?: { sweep?: ReturnType<typeof vi.fn> };
}) {
  const stateEvolution = { run: vi.fn(), ...overrides?.stateEvolution };
  const pipeline = {
    runHourly: vi.fn(),
    runStats: vi.fn(),
    ...overrides?.pipeline,
  };
  const approval = { listAll: vi.fn(async () => []), ...overrides?.approval };
  const scheduler = { sweep: vi.fn(async () => {}), ...overrides?.scheduler };
  const runner = new DefaultJobRunner(
    stateEvolution as never,
    pipeline as never,
    approval as never,
    scheduler as never,
    createLoggerFactory()
  );
  return { runner, stateEvolution, pipeline, approval, scheduler };
}

const factResult: FactCheckRunResult = {
  chatId: 0,
  outcome: 'completed',
  runId: 1,
  processedMessages: 3,
  persistedFindings: 2,
};

describe('DefaultJobRunner.runForChat', () => {
  it('runs state-evolution and returns its result', async () => {
    const stateResult: StateEvolutionRunResult = {
      kind: 'evolved',
      behaviorEventId: 11,
      patchResults: [],
    };
    const { runner, stateEvolution } = makeRunner({
      stateEvolution: { run: vi.fn(async () => stateResult) },
    });
    const result = await runner.runForChat({
      job: 'state-evolution',
      chatId: -5,
    });
    expect(stateEvolution.run).toHaveBeenCalledWith(-5);
    expect(result).toEqual({
      job: 'state-evolution',
      chatId: -5,
      outcome: 'evolved',
      stateEvolution: stateResult,
    });
  });

  it('runs fact-check hourly for one chat', async () => {
    const { runner, pipeline } = makeRunner({
      pipeline: { runHourly: vi.fn(async () => factResult) },
    });
    const result = await runner.runForChat({ job: 'fact-check', chatId: 9 });
    expect(pipeline.runHourly).toHaveBeenCalledWith(9);
    expect(result).toEqual({
      job: 'fact-check',
      chatId: 9,
      outcome: 'completed',
      factCheck: factResult,
    });
  });

  it('runs fact-check-stats for one chat with a period', async () => {
    const { runner, pipeline } = makeRunner({
      pipeline: { runStats: vi.fn(async () => factResult) },
    });
    const result = await runner.runForChat({
      job: 'fact-check-stats',
      chatId: 9,
      period: 'weekly',
    });
    expect(pipeline.runStats).toHaveBeenCalledWith(9, 'weekly');
    expect(result).toEqual({
      job: 'fact-check-stats',
      chatId: 9,
      period: 'weekly',
      outcome: 'completed',
      factCheck: factResult,
    });
  });
});

describe('DefaultJobRunner.runForAllChats', () => {
  it('runs fact-check only for approved chats and aggregates', async () => {
    const { runner, pipeline, approval } = makeRunner({
      pipeline: { runHourly: vi.fn(async () => factResult) },
      approval: {
        listAll: vi.fn(async () => [
          { chatId: 1, status: 'approved' },
          { chatId: 2, status: 'pending' },
          { chatId: 3, status: 'approved' },
        ]),
      },
    });
    const result = await runner.runForAllChats({ job: 'fact-check' });
    expect(approval.listAll).toHaveBeenCalledTimes(1);
    expect(pipeline.runHourly).toHaveBeenCalledTimes(2);
    expect(pipeline.runHourly).toHaveBeenCalledWith(1);
    expect(pipeline.runHourly).toHaveBeenCalledWith(3);
    expect(result).toEqual({
      job: 'fact-check',
      scope: 'all',
      totalChats: 2,
      results: [
        {
          job: 'fact-check',
          chatId: 1,
          outcome: 'completed',
          factCheck: factResult,
        },
        {
          job: 'fact-check',
          chatId: 3,
          outcome: 'completed',
          factCheck: factResult,
        },
      ],
    });
  });

  it('passes the period through for fact-check-stats all-chats', async () => {
    const { runner, pipeline } = makeRunner({
      pipeline: { runStats: vi.fn(async () => factResult) },
      approval: {
        listAll: vi.fn(async () => [{ chatId: 1, status: 'approved' }]),
      },
    });
    const result = await runner.runForAllChats({
      job: 'fact-check-stats',
      period: 'daily',
    });
    expect(pipeline.runStats).toHaveBeenCalledWith(1, 'daily');
    expect(result).toEqual({
      job: 'fact-check-stats',
      scope: 'all',
      totalChats: 1,
      results: [
        {
          job: 'fact-check-stats',
          chatId: 1,
          period: 'daily',
          outcome: 'completed',
          factCheck: factResult,
        },
      ],
    });
  });

  it('continues past a failing chat and logs it', async () => {
    const runHourly = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(factResult);
    const { runner } = makeRunner({
      pipeline: { runHourly },
      approval: {
        listAll: vi.fn(async () => [
          { chatId: 1, status: 'approved' },
          { chatId: 2, status: 'approved' },
        ]),
      },
    });
    const result = await runner.runForAllChats({ job: 'fact-check' });
    expect(runHourly).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      job: 'fact-check',
      scope: 'all',
      totalChats: 2,
      results: [
        {
          job: 'fact-check',
          chatId: 2,
          outcome: 'completed',
          factCheck: factResult,
        },
      ],
    });
  });

  it('delegates state-evolution all-chats to the scheduler sweep', async () => {
    const sweep = vi.fn(async () => {});
    const { runner, approval } = makeRunner({ scheduler: { sweep } });
    const result = await runner.runForAllChats({ job: 'state-evolution' });
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(approval.listAll).not.toHaveBeenCalled();
    expect(result).toEqual({
      job: 'state-evolution',
      scope: 'all',
      outcome: 'swept',
    });
  });
});
