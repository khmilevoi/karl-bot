import { inject, injectable } from 'inversify';

import {
  STATE_EVOLUTION_PASS_ID,
  type StateEvolutionPass,
} from '@/application/behavior/StateEvolutionPass';
import {
  FACT_CHECK_PIPELINE_ID,
  type FactCheckPipeline,
} from '@/application/fact-checking/FactCheckPipeline';
import {
  type ManualJobRunner,
  type ManualJobRunInput,
  type ManualJobRunResult,
} from '@/application/interfaces/scheduler/ManualJobRunner';
import {
  TOPIC_OF_DAY_SCHEDULER_ID,
  type TopicOfDayScheduler,
} from '@/application/interfaces/scheduler/TopicOfDayScheduler';

@injectable()
export class DefaultManualJobRunner implements ManualJobRunner {
  constructor(
    @inject(TOPIC_OF_DAY_SCHEDULER_ID)
    private readonly topicOfDay: TopicOfDayScheduler,
    @inject(STATE_EVOLUTION_PASS_ID)
    private readonly stateEvolution: StateEvolutionPass,
    @inject(FACT_CHECK_PIPELINE_ID)
    private readonly factCheckPipeline: FactCheckPipeline
  ) {}

  async run(input: ManualJobRunInput): Promise<ManualJobRunResult> {
    switch (input.job) {
      case 'topic-of-day':
        await this.topicOfDay.runNow(input.chatId);
        return {
          job: input.job,
          chatId: input.chatId,
          outcome: 'completed',
        };
      case 'state-evolution': {
        const result = await this.stateEvolution.run(input.chatId);
        return {
          job: input.job,
          chatId: input.chatId,
          outcome: result.kind,
          stateEvolution: result,
        };
      }
      case 'fact-check': {
        const result = await this.factCheckPipeline.runHourly(input.chatId);
        return {
          job: input.job,
          chatId: input.chatId,
          outcome: result.outcome,
          factCheck: result,
        };
      }
    }
  }
}
