import type { ServiceIdentifier } from 'inversify';

import type {
  EvolutionPatch,
  LiveStatePatch,
  TruthPatch,
} from '@/domain/behavior/schemas/patches';
import type { ChatMessage } from '@/domain/messages/ChatMessage';

import type { BehaviorPatchResult } from './BehaviorTypes';

export interface StatePatchApplicatorConfig {
  truthStableConfidence: number;
  truthDuplicateSimilarity: number;
}

export const DEFAULT_STATE_PATCH_APPLICATOR_CONFIG: StatePatchApplicatorConfig =
  {
    truthStableConfidence: 0.75,
    truthDuplicateSimilarity: 0.9,
  };

export interface StatePatchApplicator {
  applyPatches(params: {
    chatId: number;
    patches: readonly LiveStatePatch[];
    contextMessages: readonly ChatMessage[];
    nowIso?: string;
    nowMs?: number;
  }): Promise<BehaviorPatchResult[]>;
  applyEvolutionPatches(params: {
    chatId: number;
    patches: readonly EvolutionPatch[];
    reviewedByStrongModel: boolean;
    nowIso?: string;
  }): Promise<BehaviorPatchResult[]>;
  applyTruthPatches(params: {
    chatId: number;
    patches: readonly TruthPatch[];
    nowIso?: string;
  }): Promise<BehaviorPatchResult[]>;
}

export const STATE_PATCH_APPLICATOR_CONFIG_ID = Symbol.for(
  'StatePatchApplicatorConfig'
) as ServiceIdentifier<StatePatchApplicatorConfig>;

export const STATE_PATCH_APPLICATOR_ID = Symbol.for(
  'StatePatchApplicator'
) as ServiceIdentifier<StatePatchApplicator>;
