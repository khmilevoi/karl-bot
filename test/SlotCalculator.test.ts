import { describe, expect, it } from 'vitest';

import { SlotCalculator } from '../src/application/scheduler/SlotCalculator';

const at = (iso: string) => new Date(iso);

describe('SlotCalculator (UTC)', () => {
  const calc = new SlotCalculator('UTC');

  it('hourly fact-check slot buckets by civil hour', () => {
    const slot = calc.hourlyFactCheck(at('2026-06-08T14:30:00.000Z'));
    expect(slot.jobName).toBe('fact-check');
    expect(slot.slotKey).toBe('fact-check:2026-06-08T14');
    expect(slot.payloadJson).toBe('{}');
    expect(slot.runAfter).toBe('2026-06-08T14:30:00.000Z');
  });

  it('state-evolution slot buckets by civil hour', () => {
    const slot = calc.stateEvolution(at('2026-06-08T14:30:00.000Z'));
    expect(slot.jobName).toBe('state-evolution');
    expect(slot.slotKey).toBe('state-evolution:2026-06-08T14');
    expect(slot.payloadJson).toBe('{}');
  });

  it('daily stats slot buckets by civil day with period payload', () => {
    const slot = calc.dailyStats(at('2026-06-08T14:30:00.000Z'));
    expect(slot.jobName).toBe('fact-check-stats');
    expect(slot.slotKey).toBe('fact-check-stats:daily:2026-06-08');
    expect(slot.payloadJson).toBe('{"period":"daily"}');
  });

  it('weekly stats slot uses ISO week', () => {
    const slot = calc.weeklyStats(at('2026-06-08T14:30:00.000Z'));
    expect(slot.slotKey).toBe('fact-check-stats:weekly:2026-W24');
    expect(slot.payloadJson).toBe('{"period":"weekly"}');
  });

  it('monthly stats slot buckets by civil month', () => {
    const slot = calc.monthlyStats(at('2026-06-08T14:30:00.000Z'));
    expect(slot.slotKey).toBe('fact-check-stats:monthly:2026-06');
    expect(slot.payloadJson).toBe('{"period":"monthly"}');
  });
});

describe('SlotCalculator (timezone-aware)', () => {
  const calc = new SlotCalculator('Europe/Warsaw');

  it('computes the civil day in the configured timezone, not UTC', () => {
    const slot = calc.dailyStats(at('2026-06-08T23:30:00.000Z'));
    expect(slot.slotKey).toBe('fact-check-stats:daily:2026-06-09');
  });

  it('computes the civil hour in the configured timezone', () => {
    const slot = calc.hourlyFactCheck(at('2026-06-08T23:30:00.000Z'));
    expect(slot.slotKey).toBe('fact-check:2026-06-09T01');
  });
});
