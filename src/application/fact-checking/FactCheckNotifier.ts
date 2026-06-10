import type { ServiceIdentifier } from 'inversify';

export interface FactCheckNotifier {
  sendImmediate(chatId: number): Promise<void>;
  sendHourlyDigest(chatId: number): Promise<void>;
  sendStats(
    chatId: number,
    period: 'daily' | 'weekly' | 'monthly'
  ): Promise<void>;
}

export const FACT_CHECK_NOTIFIER_ID = Symbol.for(
  'FactCheckNotifier'
) as ServiceIdentifier<FactCheckNotifier>;
