import { injectable } from 'inversify';

import type {
  AnyPatch,
  PatchDecision,
  PatchPolicy,
  PatchPolicyConfig,
} from './PatchPolicy';

@injectable()
export class DefaultPatchPolicy implements PatchPolicy {
  constructor(private readonly config: PatchPolicyConfig) {}

  evaluate(patch: AnyPatch): PatchDecision {
    if (patch.evidence.messageIds.length === 0) {
      return { outcome: 'reject', reason: 'missing evidence message ids' };
    }

    const boundaryHit = this.hitsHardBoundary(this.patchText(patch));
    if (boundaryHit) {
      return { outcome: 'reject', reason: 'hard boundary term in patch text' };
    }

    switch (patch.type) {
      case 'politics.add_position': {
        const { confidence } = patch.evidence;
        const strong =
          patch.requestedIntensity === 'strong' ||
          patch.requestedIntensity === 'radical';
        if (confidence < this.config.politicalWeakMaxConfidence) {
          return { outcome: 'to_uncertainty', reason: 'weak political claim' };
        }
        if (strong && confidence < this.config.politicalStrongMinConfidence) {
          return {
            outcome: 'to_uncertainty',
            reason: 'strong claim lacks confidence',
          };
        }
        if (patch.requestedIntensity === 'radical') {
          return {
            outcome: 'escalate',
            reason: 'radical position requires stronger-model review',
          };
        }
        return { outcome: 'accept', reason: 'political position accepted' };
      }
      case 'personality.add_signal': {
        if (patch.evidence.confidence < this.config.personalityMinConfidence) {
          return {
            outcome: 'reject',
            reason: 'low-confidence personality signal',
          };
        }
        return { outcome: 'accept', reason: 'personality signal accepted' };
      }
      default:
        return { outcome: 'accept', reason: 'patch accepted' };
    }
  }

  private patchText(patch: AnyPatch): string {
    switch (patch.type) {
      case 'user.add_label':
        return patch.label;
      case 'user.add_pattern':
        return patch.text;
      case 'user.add_grudge':
        return patch.text;
      case 'user.contest_profile_signal':
        return patch.target.text;
      case 'truth.add':
        return patch.text;
      case 'truth.contest':
        return patch.counterText;
      case 'truth.revise':
        return patch.revisedText;
      case 'personality.add_signal':
        return patch.text;
      case 'politics.add_position':
        return `${patch.topic} ${patch.stance}`;
      case 'politics.add_uncertainty':
        return `${patch.topic} ${patch.summary}`;
      default:
        return '';
    }
  }

  private hitsHardBoundary(text: string): boolean {
    const lower = text.toLowerCase();
    return this.config.hardBoundaryTerms.some((term) =>
      lower.includes(term.toLowerCase())
    );
  }
}
