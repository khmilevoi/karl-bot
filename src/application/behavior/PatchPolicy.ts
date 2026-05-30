import type { ServiceIdentifier } from 'inversify';

import type { LiveStatePatch } from '@/domain/behavior/schemas/patches';
import type { EvolutionPatch } from '@/domain/behavior/schemas/patches';

export type AnyPatch = LiveStatePatch | EvolutionPatch;

export type PatchOutcome =
  | 'accept'
  | 'reject'
  | 'to_uncertainty'
  | 'downgrade'
  | 'escalate';

export interface PatchDecision {
  outcome: PatchOutcome;
  reason: string;
}

export interface PatchPolicy {
  evaluate(patch: AnyPatch): PatchDecision;
}

export interface PatchPolicyConfig {
  personalityMinConfidence: number;
  politicalWeakMaxConfidence: number;
  politicalStrongMinConfidence: number;
  hardBoundaryTerms: readonly string[];
}

export const PATCH_POLICY_ID = Symbol.for(
  'PatchPolicy'
) as ServiceIdentifier<PatchPolicy>;
