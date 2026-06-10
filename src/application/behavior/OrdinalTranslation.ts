import type { MessageReferenceMap } from '@/application/prompts/MessageReferenceMap';
import type { BehaviorGateDecision } from '@/domain/behavior/schemas/gate';
import type {
  EvolutionPatch,
  LiveStatePatch,
  TruthPatch,
} from '@/domain/behavior/schemas/patches';
import type { PatchEvidence } from '@/domain/behavior/schemas/primitives';

export function translateGateDecision(
  decision: BehaviorGateDecision,
  refMap: MessageReferenceMap
): BehaviorGateDecision {
  return {
    ...decision,
    triggerMessageIds: refMap.translate(decision.triggerMessageIds),
    contextMessageIds: refMap.translate(decision.contextMessageIds),
  };
}

function withTranslatedEvidence<P extends { evidence: PatchEvidence }>(
  patch: P,
  refMap: MessageReferenceMap
): P {
  return {
    ...patch,
    evidence: {
      ...patch.evidence,
      messageIds: refMap.translate(patch.evidence.messageIds),
    },
  };
}

export function translateLivePatches(
  patches: readonly LiveStatePatch[],
  refMap: MessageReferenceMap
): LiveStatePatch[] {
  return patches.map((patch) => withTranslatedEvidence(patch, refMap));
}

export function translateEvolutionPatches(
  patches: readonly EvolutionPatch[],
  refMap: MessageReferenceMap
): EvolutionPatch[] {
  return patches.map((patch) => withTranslatedEvidence(patch, refMap));
}

export function translateTruthPatches(
  patches: readonly TruthPatch[],
  refMap: MessageReferenceMap
): TruthPatch[] {
  return patches.map((patch) => withTranslatedEvidence(patch, refMap));
}
