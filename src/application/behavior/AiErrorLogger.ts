import type { ServiceIdentifier } from 'inversify';

export interface AiErrorLogger {
  log(params: {
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
  }): Promise<number>;
}

export const AI_ERROR_LOGGER_ID = Symbol.for(
  'AiErrorLogger'
) as ServiceIdentifier<AiErrorLogger>;
