import { describe, expect, it, vi } from 'vitest';

import { DefaultStateEvolutionWorker } from '../src/application/behavior/DefaultStateEvolutionWorker';
import type { StateEvolutionPass } from '../src/application/behavior/StateEvolutionPass';
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

function makeWorker(passRun: ReturnType<typeof vi.fn>) {
  const pass: StateEvolutionPass = {
    run: passRun,
  };
  return new DefaultStateEvolutionWorker(pass, createLoggerFactory());
}

describe('DefaultStateEvolutionWorker', () => {
  it('starts a run when requestRun is called and pass.run resolves', async () => {
    let resolveRun!: () => void;
    const runPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const passRun = vi.fn().mockReturnValue(
      runPromise.then(() => ({
        kind: 'evolved',
        behaviorEventId: 1,
        patchResults: [],
      }))
    );
    const worker = makeWorker(passRun);

    worker.requestRun(1);
    expect(passRun).toHaveBeenCalledTimes(1);
    resolveRun();
    await runPromise;
    // Give the drain loop a chance to finish
    await Promise.resolve();
  });

  it('does not start a second run while one is in flight', async () => {
    let resolveFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const passRun = vi
      .fn()
      .mockReturnValueOnce(
        firstRun.then(() => ({
          kind: 'evolved',
          behaviorEventId: 1,
          patchResults: [],
        }))
      )
      .mockResolvedValue({ kind: 'skipped' });

    const worker = makeWorker(passRun);

    worker.requestRun(1);
    worker.requestRun(1); // second call while in flight

    expect(passRun).toHaveBeenCalledTimes(1);

    resolveFirst();
    await firstRun;
    // Allow the rerun to happen
    await new Promise((r) => setTimeout(r, 0));
    // Now the rerun should have fired
    expect(passRun).toHaveBeenCalledTimes(2);
  });

  it('reruns exactly once after completion if requested during run', async () => {
    let resolveFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const passRun = vi
      .fn()
      .mockReturnValueOnce(
        firstRun.then(() => ({
          kind: 'evolved',
          behaviorEventId: 1,
          patchResults: [],
        }))
      )
      .mockResolvedValue({ kind: 'skipped' });

    const worker = makeWorker(passRun);

    worker.requestRun(1);
    worker.requestRun(1);
    worker.requestRun(1); // multiple during flight — should still only rerun once

    resolveFirst();
    await firstRun;
    await new Promise((r) => setTimeout(r, 0));

    expect(passRun).toHaveBeenCalledTimes(2);
  });

  it('recovers from a thrown pass.run and allows the next requestRun', async () => {
    const passRun = vi
      .fn()
      .mockRejectedValueOnce(new Error('exploded'))
      .mockResolvedValue({ kind: 'skipped' });

    const worker = makeWorker(passRun);

    worker.requestRun(1);
    // Let the first (failing) run complete
    await new Promise((r) => setTimeout(r, 0));

    // Now the worker should have cleaned up — a new requestRun should work
    worker.requestRun(1);
    await new Promise((r) => setTimeout(r, 0));

    expect(passRun).toHaveBeenCalledTimes(2);
  });
});
