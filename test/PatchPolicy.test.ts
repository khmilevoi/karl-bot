import { describe, expect, it } from 'vitest';

import { DefaultPatchPolicy } from '../src/application/behavior/DefaultPatchPolicy';
import type { AnyPatch } from '../src/application/behavior/PatchPolicy';

const policy = new DefaultPatchPolicy({
  personalityMinConfidence: 0.5,
  politicalWeakMaxConfidence: 0.4,
  politicalStrongMinConfidence: 0.7,
  hardBoundaryTerms: ['exterminate'],
});

const ev = (confidence: number, ids: number[] = [1]) => ({
  messageIds: ids,
  summary: 's',
  confidence,
});

describe('DefaultPatchPolicy', () => {
  it('rejects any patch with no evidence message ids', () => {
    const patch: AnyPatch = {
      type: 'user.add_label',
      userId: 1,
      label: 'funny',
      evidence: ev(0.9, []),
    };
    expect(policy.evaluate(patch).outcome).toBe('reject');
  });

  it('accepts a well-evidenced affinity adjustment', () => {
    const patch: AnyPatch = {
      type: 'user.adjust_affinity',
      userId: 1,
      delta: 1,
      evidence: ev(0.6),
    };
    expect(policy.evaluate(patch).outcome).toBe('accept');
  });

  it('routes a weak political claim to uncertainty', () => {
    const patch: AnyPatch = {
      type: 'politics.add_position',
      topic: 'trade',
      stance: 'mild protectionism',
      requestedIntensity: 'weak',
      evidence: ev(0.3),
    };
    expect(policy.evaluate(patch).outcome).toBe('to_uncertainty');
  });

  it('routes a strong claim with insufficient confidence to uncertainty', () => {
    const patch: AnyPatch = {
      type: 'politics.add_position',
      topic: 'taxes',
      stance: 'sharply higher',
      requestedIntensity: 'strong',
      evidence: ev(0.5),
    };
    expect(policy.evaluate(patch).outcome).toBe('to_uncertainty');
  });

  it('escalates a confident radical position for stronger-model review', () => {
    const patch: AnyPatch = {
      type: 'politics.add_position',
      topic: 'reform',
      stance: 'total overhaul',
      requestedIntensity: 'radical',
      evidence: ev(0.9),
    };
    expect(policy.evaluate(patch).outcome).toBe('escalate');
  });

  it('rejects a patch hitting a hard-boundary term', () => {
    const patch: AnyPatch = {
      type: 'politics.add_position',
      topic: 'group',
      stance: 'we should exterminate them',
      requestedIntensity: 'radical',
      evidence: ev(0.95),
    };
    expect(policy.evaluate(patch).outcome).toBe('reject');
  });

  it('rejects a low-confidence personality signal', () => {
    const patch: AnyPatch = {
      type: 'personality.add_signal',
      area: 'values',
      polarity: 'reinforce',
      text: 'values privacy',
      evidence: ev(0.2),
    };
    expect(policy.evaluate(patch).outcome).toBe('reject');
  });

  it('accepts a confident personality signal', () => {
    const patch: AnyPatch = {
      type: 'personality.add_signal',
      area: 'values',
      polarity: 'reinforce',
      text: 'values privacy',
      evidence: ev(0.8),
    };
    expect(policy.evaluate(patch).outcome).toBe('accept');
  });
});
