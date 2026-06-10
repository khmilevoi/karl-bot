import { inject, injectable } from 'inversify';

import type {
  AiErrorEventEntity,
  NewAiErrorEvent,
} from '@/domain/entities/AiErrorEventEntity';
import type { AiErrorEventRepository } from '@/domain/repositories/AiErrorEventRepository';
import {
  DB_PROVIDER_ID,
  type DbProvider,
} from '@/domain/repositories/DbProvider';

interface AiErrorEventRow {
  id: number;
  chat_id: number | null;
  source: string;
  severity: string;
  error_code: string;
  message: string;
  component: string;
  operation: string;
  input_ref_json: string | null;
  output_ref_json: string | null;
  stack_hash: string | null;
  fix_hint: string;
  status: string;
  created_at: string;
}

function toEntity(row: AiErrorEventRow): AiErrorEventEntity {
  return {
    id: row.id,
    chatId: row.chat_id,
    source: row.source,
    severity: row.severity as AiErrorEventEntity['severity'],
    errorCode: row.error_code,
    message: row.message,
    component: row.component,
    operation: row.operation,
    inputRefJson: row.input_ref_json,
    outputRefJson: row.output_ref_json,
    stackHash: row.stack_hash,
    fixHint: row.fix_hint,
    status: row.status as AiErrorEventEntity['status'],
    createdAt: row.created_at,
  };
}

@injectable()
export class SQLiteAiErrorEventRepository implements AiErrorEventRepository {
  constructor(
    @inject(DB_PROVIDER_ID) private readonly dbProvider: DbProvider
  ) {}

  async insert(event: NewAiErrorEvent): Promise<number> {
    const db = await this.dbProvider.get();
    const result = (await db.run(
      `INSERT INTO ai_error_events
        (chat_id, source, severity, error_code, message, component, operation, input_ref_json, output_ref_json, stack_hash, fix_hint, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.chatId,
      event.source,
      event.severity,
      event.errorCode,
      event.message,
      event.component,
      event.operation,
      event.inputRefJson,
      event.outputRefJson,
      event.stackHash,
      event.fixHint,
      event.status,
      event.createdAt
    )) as { lastID?: number };
    return result.lastID ?? 0;
  }

  async findById(id: number): Promise<AiErrorEventEntity | undefined> {
    const db = await this.dbProvider.get();
    const row = await db.get<AiErrorEventRow>(
      'SELECT * FROM ai_error_events WHERE id = ?',
      id
    );
    return row ? toEntity(row) : undefined;
  }
}
