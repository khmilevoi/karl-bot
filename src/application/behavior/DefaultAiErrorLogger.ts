import { inject, injectable } from 'inversify';

import {
  AI_ERROR_EVENT_REPOSITORY_ID,
  type AiErrorEventRepository,
} from '@/domain/repositories/AiErrorEventRepository';

import type { AiErrorLogger } from './AiErrorLogger';

@injectable()
export class DefaultAiErrorLogger implements AiErrorLogger {
  constructor(
    @inject(AI_ERROR_EVENT_REPOSITORY_ID)
    private readonly repo: AiErrorEventRepository
  ) {}

  async log(params: {
    chatId: number | null;
    source: string;
    severity: 'warning' | 'error' | 'critical';
    errorCode: string;
    message: string;
    component: string;
    operation: string;
    inputRef?: unknown;
    outputRef?: unknown;
    stackHash?: string | null;
    fixHint: string;
  }): Promise<number> {
    return this.repo.insert({
      chatId: params.chatId,
      source: params.source,
      severity: params.severity,
      errorCode: params.errorCode,
      message: params.message,
      component: params.component,
      operation: params.operation,
      inputRefJson: this.toRefJson(params.inputRef),
      outputRefJson: this.toRefJson(params.outputRef),
      stackHash: params.stackHash ?? null,
      fixHint: params.fixHint,
      status: 'open',
      createdAt: new Date().toISOString(),
    });
  }

  private toRefJson(value: unknown): string | null {
    if (value === undefined) {
      return null;
    }
    const raw = JSON.stringify(value);
    return raw.length > 2000 ? `${raw.slice(0, 2000)}...` : raw;
  }
}
