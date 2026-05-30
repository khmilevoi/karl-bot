export interface BehaviorEventEntity {
  id: number;
  chatId: number;
  schemaVersion: string;
  gateReason: string | null;
  gateConfidence: number | null;
  gateStateImpactRisk: string | null;
  triggerMessageIdsJson: string;
  contextMessageIdsJson: string;
  modelSlot: string;
  selectedModel: string;
  escalated: boolean;
  escalationReason: string | null;
  actionsJson: string;
  actionResultsJson: string;
  statePatchesJson: string;
  patchResultsJson: string;
  confidence: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export type NewBehaviorEvent = Omit<BehaviorEventEntity, 'id'>;
