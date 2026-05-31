export interface AdminService {
  createAccessKey(
    chatId: number,
    userId: number,
    ttlMs?: number
  ): Promise<Date>;
  hasAccess(chatId: number, userId: number): Promise<boolean>;
  exportTables(): Promise<{ filename: string; buffer: Buffer }[]>;
  exportChatData(
    chatId: number
  ): Promise<{ filename: string; buffer: Buffer }[]>;
  setHistoryLimit(chatId: number, value: number): Promise<void>;
}

import type { ServiceIdentifier } from 'inversify';

export const ADMIN_SERVICE_ID = Symbol.for(
  'AdminService'
) as ServiceIdentifier<AdminService>;
