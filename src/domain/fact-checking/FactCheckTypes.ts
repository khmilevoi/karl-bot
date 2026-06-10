export type FactCheckCategory =
  | 'external_fact'
  | 'chat_history'
  | 'medical'
  | 'legal'
  | 'financial'
  | 'safety'
  | 'mixed';

export type FactCheckSeverity = 'low' | 'medium' | 'high';
export type FactCheckStatus = 'confirmed' | 'uncertain';
export type FactCheckVerificationStatus = FactCheckStatus | 'no_error';
export type FactCheckSourcePolicy =
  | 'chat_history_only'
  | 'reliable_or_media_allowed'
  | 'primary_required';
export type FactCheckSourceReliability =
  | 'primary'
  | 'authoritative'
  | 'media'
  | 'weak';

export interface ExtractedClaim {
  messageId: number;
  claimText: string;
  category: FactCheckCategory;
  needsExternalSources: boolean;
  riskLevel: FactCheckSeverity;
  whyCheckable: string;
  contextMessageIds: number[];
}

export interface VerificationFinding {
  messageId: number;
  claimText: string;
  status: FactCheckVerificationStatus;
  confidence: number;
  correctedFact: string;
  explanation: string;
  sourceRequirementsMet: boolean;
  sourceIndexes: number[];
  shouldNotifyImmediately: boolean;
}
