import { inject, injectable } from 'inversify';

import {
  STATE_EVOLUTION_PASS_ID,
  type StateEvolutionPass,
} from '@/application/behavior/StateEvolutionPass';
import {
  STATE_EVOLUTION_SCHEDULER_ID,
  type StateEvolutionScheduler,
} from '@/application/behavior/StateEvolutionScheduler';
import {
  FACT_CHECK_PIPELINE_ID,
  type FactCheckPipeline,
} from '@/application/fact-checking/FactCheckPipeline';
import {
  CHAT_APPROVAL_SERVICE_ID,
  type ChatApprovalService,
} from '@/application/interfaces/chat/ChatApprovalService';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import {
  type AllChatsJobInput,
  type AllChatsJobResult,
  type JobRunInput,
  type JobRunner,
  type JobRunResult,
} from '@/application/interfaces/scheduler/JobRunner';

@injectable()
export class DefaultJobRunner implements JobRunner {
  private readonly logger: Logger;

  constructor(
    @inject(STATE_EVOLUTION_PASS_ID)
    private readonly stateEvolution: StateEvolutionPass,
    @inject(FACT_CHECK_PIPELINE_ID)
    private readonly factCheckPipeline: FactCheckPipeline,
    @inject(CHAT_APPROVAL_SERVICE_ID)
    private readonly chatApproval: ChatApprovalService,
    @inject(STATE_EVOLUTION_SCHEDULER_ID)
    private readonly stateEvolutionScheduler: StateEvolutionScheduler,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('JobRunner');
  }

  async runForChat(input: JobRunInput): Promise<JobRunResult> {
    switch (input.job) {
      case 'state-evolution': {
        const result = await this.stateEvolution.run(input.chatId);
        return {
          job: 'state-evolution',
          chatId: input.chatId,
          outcome: result.kind,
          stateEvolution: result,
        };
      }
      case 'fact-check': {
        const result = await this.factCheckPipeline.runHourly(input.chatId);
        return {
          job: 'fact-check',
          chatId: input.chatId,
          outcome: result.outcome,
          factCheck: result,
        };
      }
      case 'fact-check-stats': {
        const result = await this.factCheckPipeline.runStats(
          input.chatId,
          input.period
        );
        return {
          job: 'fact-check-stats',
          chatId: input.chatId,
          period: input.period,
          outcome: result.outcome,
          factCheck: result,
        };
      }
    }
  }

  async runForAllChats(input: AllChatsJobInput): Promise<AllChatsJobResult> {
    switch (input.job) {
      case 'state-evolution':
        await this.stateEvolutionScheduler.sweep();
        return { job: 'state-evolution', scope: 'all', outcome: 'swept' };
      case 'fact-check':
        return this.runEachApproved('fact-check', (chatId) => ({
          job: 'fact-check',
          chatId,
        }));
      case 'fact-check-stats': {
        const { period } = input;
        return this.runEachApproved('fact-check-stats', (chatId) => ({
          job: 'fact-check-stats',
          chatId,
          period,
        }));
      }
    }
  }

  private async runEachApproved(
    job: 'fact-check' | 'fact-check-stats',
    toInput: (chatId: number) => JobRunInput
  ): Promise<AllChatsJobResult> {
    const chats = await this.chatApproval.listAll();
    const approved = chats.filter((chat) => chat.status === 'approved');
    const results: JobRunResult[] = [];

    for (const { chatId } of approved) {
      try {
        results.push(await this.runForChat(toInput(chatId)));
      } catch (error) {
        this.logger.error(
          { error, chatId, job },
          'All-chats job run failed for chat'
        );
      }
    }

    return { job, scope: 'all', totalChats: approved.length, results };
  }
}
