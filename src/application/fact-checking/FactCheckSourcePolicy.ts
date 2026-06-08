import type {
  FactCheckCategory,
  FactCheckSourcePolicy,
  FactCheckSourceReliability,
} from '@/domain/fact-checking/FactCheckTypes';

export interface SourcePolicyInput {
  category: FactCheckCategory;
  sourcePolicy: FactCheckSourcePolicy;
  sourceRequirementsMet: boolean;
  sources: readonly { reliability: FactCheckSourceReliability }[];
}

export function getSourcePolicyForCategory(
  category: FactCheckCategory
): FactCheckSourcePolicy {
  switch (category) {
    case 'chat_history':
      return 'chat_history_only';
    case 'medical':
    case 'legal':
    case 'financial':
    case 'safety':
      return 'primary_required';
    case 'external_fact':
    case 'mixed':
      return 'reliable_or_media_allowed';
  }
}

export function canConfirmFinding(input: SourcePolicyInput): boolean {
  if (!input.sourceRequirementsMet) return false;
  switch (input.sourcePolicy) {
    case 'chat_history_only':
      return input.category === 'chat_history';
    case 'primary_required':
      return input.sources.some((s) =>
        ['primary', 'authoritative'].includes(s.reliability)
      );
    case 'reliable_or_media_allowed':
      return input.sources.some((s) =>
        ['primary', 'authoritative', 'media'].includes(s.reliability)
      );
  }
}
