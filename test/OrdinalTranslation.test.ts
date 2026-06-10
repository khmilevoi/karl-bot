import { describe, expect, it } from 'vitest';

import {
  translateEvolutionPatches,
  translateGateDecision,
  translateLivePatches,
} from '../src/application/behavior/OrdinalTranslation';
import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';
import type { BehaviorGateDecision } from '../src/domain/behavior/schemas/gate';
import type {
  EvolutionPatch,
  LiveStatePatch,
} from '../src/domain/behavior/schemas/patches';

const map = MessageReferenceMap.fromMessages([{ id: 150 }, { id: 161 }]);

describe('translateGateDecision', () => {
  it('maps trigger/context ordinals to store ids', () => {
    const decision: BehaviorGateDecision = {
      shouldDecide: true,
      confidence: 0.9,
      reason: 'conflict',
      triggerMessageIds: [1],
      contextMessageIds: [2, 99],
      stateImpactRisk: 'low',
    };
    const out = translateGateDecision(decision, map);
    expect(out.triggerMessageIds).toEqual([150]);
    expect(out.contextMessageIds).toEqual([161]);
  });
});

describe('translateLivePatches', () => {
  it('maps evidence.messageIds and leaves other fields intact', () => {
    const patches: LiveStatePatch[] = [
      {
        type: 'truth.reinforce',
        truthId: 5,
        evidence: { messageIds: [1, 2], summary: 's', confidence: 0.8 },
      },
    ];
    const out = translateLivePatches(patches, map);
    expect(out[0]).toMatchObject({ type: 'truth.reinforce', truthId: 5 });
    expect(out[0].evidence.messageIds).toEqual([150, 161]);
  });
});

describe('translateEvolutionPatches', () => {
  it('maps evidence.messageIds for evolution patches', () => {
    const patches: EvolutionPatch[] = [
      {
        type: 'personality.add_signal',
        area: 'identity',
        polarity: 'reinforce',
        text: 't',
        evidence: { messageIds: [2], summary: 's', confidence: 0.5 },
      },
    ];
    const out = translateEvolutionPatches(patches, map);
    expect(out[0].evidence.messageIds).toEqual([161]);
  });
});
