import { inject, injectable } from 'inversify';

import type {
  BehaviorEventEntity,
  NewBehaviorEvent,
} from '@/domain/entities/BehaviorEventEntity';
import type { BehaviorEventRepository } from '@/domain/repositories/BehaviorEventRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';

interface BehaviorEventRow {
  id: number;
  chat_id: number;
  schema_version: string;
  gate_reason: string | null;
  gate_confidence: number | null;
  gate_state_impact_risk: string | null;
  trigger_message_ids_json: string;
  context_message_ids_json: string;
  model_slot: string;
  selected_model: string;
  escalated: number;
  escalation_reason: string | null;
  actions_json: string;
  action_results_json: string;
  state_patches_json: string;
  patch_results_json: string;
  confidence: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  created_at: string;
}

function toEntity(row: BehaviorEventRow): BehaviorEventEntity {
  return {
    id: row.id,
    chatId: row.chat_id,
    schemaVersion: row.schema_version,
    gateReason: row.gate_reason,
    gateConfidence: row.gate_confidence,
    gateStateImpactRisk: row.gate_state_impact_risk,
    triggerMessageIdsJson: row.trigger_message_ids_json,
    contextMessageIdsJson: row.context_message_ids_json,
    modelSlot: row.model_slot,
    selectedModel: row.selected_model,
    escalated: row.escalated === 1,
    escalationReason: row.escalation_reason,
    actionsJson: row.actions_json,
    actionResultsJson: row.action_results_json,
    statePatchesJson: row.state_patches_json,
    patchResultsJson: row.patch_results_json,
    confidence: row.confidence,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  };
}

@injectable()
export class SQLiteBehaviorEventRepository implements BehaviorEventRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async insert(event: NewBehaviorEvent): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `INSERT INTO behavior_events
        (chat_id, schema_version, gate_reason, gate_confidence, gate_state_impact_risk, trigger_message_ids_json, context_message_ids_json, model_slot, selected_model, escalated, escalation_reason, actions_json, action_results_json, state_patches_json, patch_results_json, confidence, prompt_tokens, completion_tokens, total_tokens, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.chatId,
      event.schemaVersion,
      event.gateReason,
      event.gateConfidence,
      event.gateStateImpactRisk,
      event.triggerMessageIdsJson,
      event.contextMessageIdsJson,
      event.modelSlot,
      event.selectedModel,
      event.escalated ? 1 : 0,
      event.escalationReason,
      event.actionsJson,
      event.actionResultsJson,
      event.statePatchesJson,
      event.patchResultsJson,
      event.confidence,
      event.promptTokens,
      event.completionTokens,
      event.totalTokens,
      event.latencyMs,
      event.createdAt
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async findById(id: number): Promise<BehaviorEventEntity | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<BehaviorEventRow>(
      'SELECT * FROM behavior_events WHERE id = ?',
      id
    );
    return row ? toEntity(row) : undefined;
  }

  async findByChatId(chatId: number): Promise<BehaviorEventEntity[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<BehaviorEventRow>(
      'SELECT * FROM behavior_events WHERE chat_id = ? ORDER BY id',
      chatId
    );
    return rows.map(toEntity);
  }

  async findByChatIdAfter(
    chatId: number,
    afterId: number
  ): Promise<BehaviorEventEntity[]> {
    const db = await this.dbProvider.get();
    const rows = await db.all<BehaviorEventRow>(
      'SELECT * FROM behavior_events WHERE chat_id = ? AND id > ? ORDER BY id',
      chatId,
      afterId
    );
    return rows.map(toEntity);
  }

  async countByChatIdAfter(chatId: number, afterId: number): Promise<number> {
    const db = await this.dbProvider.get();
    const row = await db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM behavior_events WHERE chat_id = ? AND id > ?',
      chatId,
      afterId
    );
    return row?.n ?? 0;
  }
}
