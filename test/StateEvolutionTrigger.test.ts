import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_STATE_EVOLUTION_CONFIG,
  type StateEvolutionConfig,
} from '../src/application/behavior/BehaviorConfig';
import { DefaultStateEvolutionTrigger } from '../src/application/behavior/DefaultStateEvolutionTrigger';
import type { StateEvolutionWorker } from '../src/application/behavior/StateEvolutionWorker';
import type { BehaviorEventRepository } from '../src/domain/repositories/BehaviorEventRepository';
import type { StateEvolutionCursorRepository } from '../src/domain/repositories/StateEvolutionCursorRepository';

const past = '2020-01-01T00:00:00.000Z';
const recentIso = new Date(Date.now() - 30_000).toISOString(); // 30s ago — within 5min cooldown
const staleIso = new Date(Date.now() - 10 * 60_000).toISOString(); // 10min ago — past cooldown

function makeTrigger(overrides?: {
  config?: Partial<StateEvolutionConfig>;
  cursor?: Partial<StateEvolutionCursorRepository>;
  events?: Partial<BehaviorEventRepository>;
  worker?: Partial<StateEvolutionWorker>;
}) {
  const config: StateEvolutionConfig = {
    ...DEFAULT_STATE_EVOLUTION_CONFIG,
    ...overrides?.config,
  };
  const cursorRepo: StateEvolutionCursorRepository = {
    get: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
    findChatsNeedingSweep: vi.fn(),
    ...overrides?.cursor,
  };
  const eventRepo: BehaviorEventRepository = {
    insert: vi.fn(),
    findById: vi.fn(),
    findByChatId: vi.fn(),
    findByChatIdAfter: vi.fn(),
    countByChatIdAfter: vi.fn().mockResolvedValue(0),
    ...overrides?.events,
  };
  const worker: StateEvolutionWorker = {
    requestRun: vi.fn(),
    ...overrides?.worker,
  };
  return {
    trigger: new DefaultStateEvolutionTrigger(
      config,
      cursorRepo,
      eventRepo,
      worker
    ),
    worker,
  };
}

describe('DefaultStateEvolutionTrigger', () => {
  it('requests run when count >= eventThreshold and cooldown elapsed (null lastRunAt)', async () => {
    const { trigger, worker } = makeTrigger({
      events: { countByChatIdAfter: vi.fn().mockResolvedValue(8) },
    });
    await trigger.maybeSchedule(1, 'low');
    expect(worker.requestRun).toHaveBeenCalledWith(1);
  });

  it('requests run when count >= highRiskEventThreshold and latestRisk is high', async () => {
    const { trigger, worker } = makeTrigger({
      events: { countByChatIdAfter: vi.fn().mockResolvedValue(3) },
    });
    await trigger.maybeSchedule(1, 'high');
    expect(worker.requestRun).toHaveBeenCalledWith(1);
  });

  it('does not request run when count is below threshold for medium risk', async () => {
    const { trigger, worker } = makeTrigger({
      events: { countByChatIdAfter: vi.fn().mockResolvedValue(7) },
    });
    await trigger.maybeSchedule(1, 'medium');
    expect(worker.requestRun).not.toHaveBeenCalled();
  });

  it('does not request run when cooldown has not elapsed', async () => {
    const { trigger, worker } = makeTrigger({
      cursor: {
        get: vi.fn().mockResolvedValue({
          chatId: 1,
          lastEventId: 0,
          lastRunAt: recentIso,
        }),
      },
      events: { countByChatIdAfter: vi.fn().mockResolvedValue(8) },
    });
    await trigger.maybeSchedule(1, 'low');
    expect(worker.requestRun).not.toHaveBeenCalled();
  });

  it('requests run when cooldown has elapsed (stale lastRunAt)', async () => {
    const { trigger, worker } = makeTrigger({
      cursor: {
        get: vi.fn().mockResolvedValue({
          chatId: 1,
          lastEventId: 0,
          lastRunAt: staleIso,
        }),
      },
      events: { countByChatIdAfter: vi.fn().mockResolvedValue(8) },
    });
    await trigger.maybeSchedule(1, 'low');
    expect(worker.requestRun).toHaveBeenCalledWith(1);
  });

  it('never requests run when enabled is false', async () => {
    const { trigger, worker } = makeTrigger({
      config: { enabled: false },
      events: { countByChatIdAfter: vi.fn().mockResolvedValue(100) },
    });
    await trigger.maybeSchedule(1, 'high');
    expect(worker.requestRun).not.toHaveBeenCalled();
  });

  it('uses lastEventId 0 and null lastRunAt when cursor is missing', async () => {
    const countFn = vi.fn().mockResolvedValue(8);
    const { trigger, worker } = makeTrigger({
      events: { countByChatIdAfter: countFn },
    });
    await trigger.maybeSchedule(1, 'low');
    expect(countFn).toHaveBeenCalledWith(1, 0);
    expect(worker.requestRun).toHaveBeenCalledWith(1);
  });
});
