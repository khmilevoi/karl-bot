import type { ServiceIdentifier } from 'inversify';

import type { StateEvolutionRunResult } from '@/application/behavior/StateEvolutionPass';

export type ManualJobName = 'state-evolution' | 'topic-of-day';

export interface ManualJobRunInput {
  job: ManualJobName;
  chatId: number;
}

export type ManualJobRunResult =
  | {
      job: 'topic-of-day';
      chatId: number;
      outcome: 'completed';
    }
  | {
      job: 'state-evolution';
      chatId: number;
      outcome: StateEvolutionRunResult['kind'];
      stateEvolution: StateEvolutionRunResult;
    };

export interface ManualJobRunner {
  run(input: ManualJobRunInput): Promise<ManualJobRunResult>;
}

export const MANUAL_JOB_RUNNER_ID = Symbol.for(
  'ManualJobRunner'
) as ServiceIdentifier<ManualJobRunner>;
