import type { ServiceIdentifier } from 'inversify';

export interface FactCheckScheduler {
  start(): Promise<void>;
}

export const FACT_CHECK_SCHEDULER_ID = Symbol.for(
  'FactCheckScheduler'
) as ServiceIdentifier<FactCheckScheduler>;
