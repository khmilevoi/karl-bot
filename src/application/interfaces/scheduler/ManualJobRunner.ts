import type { ServiceIdentifier } from 'inversify';

import type { StateEvolutionRunResult } from '@/application/behavior/StateEvolutionPass';
import type { FactCheckRunResult } from '@/application/fact-checking/FactCheckPipeline';

export type ManualJobName = 'state-evolution' | 'topic-of-day' | 'fact-check';

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
    }
  | {
      job: 'fact-check';
      chatId: number;
      outcome: FactCheckRunResult['outcome'];
      factCheck: FactCheckRunResult;
    };

export interface ManualJobRunner {
  run(input: ManualJobRunInput): Promise<ManualJobRunResult>;
}

export const MANUAL_JOB_RUNNER_ID = Symbol.for(
  'ManualJobRunner'
) as ServiceIdentifier<ManualJobRunner>;
