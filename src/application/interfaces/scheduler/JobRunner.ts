import type { ServiceIdentifier } from 'inversify';

import type { StateEvolutionRunResult } from '@/application/behavior/StateEvolutionPass';
import type { FactCheckRunResult } from '@/application/fact-checking/FactCheckPipeline';

export type JobName = 'state-evolution' | 'fact-check' | 'fact-check-stats';

export type StatsPeriod = 'daily' | 'weekly' | 'monthly';

export type JobRunInput =
  | { job: 'state-evolution'; chatId: number }
  | { job: 'fact-check'; chatId: number }
  | { job: 'fact-check-stats'; chatId: number; period: StatsPeriod };

export type JobRunResult =
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
    }
  | {
      job: 'fact-check-stats';
      chatId: number;
      period: StatsPeriod;
      outcome: FactCheckRunResult['outcome'];
      factCheck: FactCheckRunResult;
    };

export type AllChatsJobInput =
  | { job: 'state-evolution' }
  | { job: 'fact-check' }
  | { job: 'fact-check-stats'; period: StatsPeriod };

export type AllChatsJobResult =
  | {
      job: 'fact-check' | 'fact-check-stats';
      scope: 'all';
      totalChats: number;
      results: JobRunResult[];
    }
  | { job: 'state-evolution'; scope: 'all'; outcome: 'swept' };

export interface JobRunner {
  runForChat(input: JobRunInput): Promise<JobRunResult>;
  runForAllChats(input: AllChatsJobInput): Promise<AllChatsJobResult>;
}

export const JOB_RUNNER_ID = Symbol.for(
  'JobRunner'
) as ServiceIdentifier<JobRunner>;
