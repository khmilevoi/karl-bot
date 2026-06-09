import type { ServiceIdentifier } from 'inversify';

import type {
  DueSlot,
  ScheduledJob,
  ScheduledJobName,
} from '@/domain/scheduler/ScheduledJobTypes';

export interface ScheduledJobRepository {
  /** Idempotent INSERT OR IGNORE keyed on (job_name, slot_key). */
  insertDueSlot(slot: DueSlot, maxAttempts: number, now: string): Promise<void>;
  /** Atomically claim one due row (pending / due retry / stale running). */
  claimNext(now: string, lockedUntil: string): Promise<ScheduledJob | null>;
  markSucceeded(id: number, now: string): Promise<void>;
  scheduleRetry(
    id: number,
    runAfter: string,
    lastError: string,
    now: string
  ): Promise<void>;
  markFailed(id: number, lastError: string, now: string): Promise<void>;
  findBySlot(
    jobName: ScheduledJobName,
    slotKey: string
  ): Promise<ScheduledJob | null>;
}

export const SCHEDULED_JOB_REPOSITORY_ID = Symbol.for(
  'ScheduledJobRepository'
) as ServiceIdentifier<ScheduledJobRepository>;
