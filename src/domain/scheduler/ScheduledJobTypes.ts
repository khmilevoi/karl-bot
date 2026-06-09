export type ScheduledJobName =
  | 'state-evolution'
  | 'fact-check'
  | 'fact-check-stats';

export type ScheduledJobStatus =
  | 'pending'
  | 'running'
  | 'retry_scheduled'
  | 'succeeded'
  | 'failed';

export interface ScheduledJob {
  id: number;
  jobName: ScheduledJobName;
  slotKey: string;
  payloadJson: string;
  status: ScheduledJobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedUntil: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface DueSlot {
  jobName: ScheduledJobName;
  slotKey: string;
  payloadJson: string;
  runAfter: string;
}
