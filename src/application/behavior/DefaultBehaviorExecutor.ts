import { inject, injectable } from 'inversify';

import {
  CHAT_MESSENGER_ID,
  type ChatMessenger,
} from '@/application/interfaces/chat/ChatMessenger';
import type {
  BehaviorAction,
  MessageSelector,
  ReplyTarget,
  SingleMessageSelector,
} from '@/domain/behavior/schemas/actions';

import {
  BEHAVIOR_RATE_LIMITER_ID,
  type BehaviorRateLimiter,
} from './BehaviorRateLimiter';
import type { BehaviorExecutor } from './BehaviorExecutor';
import {
  BEHAVIOR_SUMMARIZATION_QUEUE_ID,
  type BehaviorSummarizationQueue,
} from './BehaviorSummarizationQueue';
import type { BehaviorActionResult, BehaviorDecisionContext } from './BehaviorTypes';

interface ResolvedMessageTarget {
  storedMessageId: number;
  telegramMessageId: number | null;
}

@injectable()
export class DefaultBehaviorExecutor implements BehaviorExecutor {
  constructor(
    @inject(CHAT_MESSENGER_ID) private readonly messenger: ChatMessenger,
    @inject(BEHAVIOR_RATE_LIMITER_ID)
    private readonly rateLimiter: BehaviorRateLimiter,
    @inject(BEHAVIOR_SUMMARIZATION_QUEUE_ID)
    private readonly summarizationQueue: BehaviorSummarizationQueue
  ) {}

  async execute(params: {
    context: BehaviorDecisionContext;
    actions: readonly BehaviorAction[];
    nowMs?: number;
  }): Promise<BehaviorActionResult[]> {
    const results: BehaviorActionResult[] = [];

    for (const action of params.actions) {
      const rateLimit = this.rateLimiter.checkAction({
        chatId: params.context.chatId,
        action,
        nowMs: params.nowMs,
      });

      if (!rateLimit.allowed) {
        results.push({
          actionType: action.type,
          outcome: 'rate_limited',
          reason: rateLimit.reason,
        });
        continue;
      }

      results.push(...(await this.executeAction(params.context, action)));
    }

    return results;
  }

  private async executeAction(
    context: BehaviorDecisionContext,
    action: BehaviorAction
  ): Promise<BehaviorActionResult[]> {
    switch (action.type) {
      case 'reply':
        return [await this.executeReply(context, action)];
      case 'ask_question':
        return [await this.executeAskQuestion(context, action)];
      case 'react':
        return this.executeReact(context, action);
      case 'summarize_thread':
        return [this.executeSummarizeThread(context, action)];
    }
  }

  private async executeReply(
    context: BehaviorDecisionContext,
    action: Extract<BehaviorAction, { type: 'reply' }>
  ): Promise<BehaviorActionResult> {
    const target = this.resolveReplyTarget(context, action.target);
    if (target.outcome !== 'resolved') {
      return {
        actionType: action.type,
        outcome: 'dropped',
        reason: target.reason,
        targetMessageId: target.targetMessageId,
      };
    }

    const extra =
      target.telegramMessageId === null
        ? undefined
        : { reply_parameters: { message_id: target.telegramMessageId } };

    try {
      await this.messenger.sendMessage(context.chatId, action.text, extra);
      return {
        actionType: action.type,
        outcome: 'sent',
        reason: null,
        targetMessageId: target.targetMessageId,
        telegramMessageId: target.telegramMessageId,
      };
    } catch (error) {
      return this.failed(action.type, error);
    }
  }

  private async executeAskQuestion(
    context: BehaviorDecisionContext,
    action: Extract<BehaviorAction, { type: 'ask_question' }>
  ): Promise<BehaviorActionResult> {
    try {
      await this.messenger.sendMessage(
        context.chatId,
        this.formatQuestion(action)
      );
      return {
        actionType: action.type,
        outcome: 'sent',
        reason: null,
      };
    } catch (error) {
      return this.failed(action.type, error);
    }
  }

  private async executeReact(
    context: BehaviorDecisionContext,
    action: Extract<BehaviorAction, { type: 'react' }>
  ): Promise<BehaviorActionResult[]> {
    const targets = this.resolveSelector(context, action.target);
    if (targets.length === 0) {
      return [
        {
          actionType: action.type,
          outcome: 'dropped',
          reason: 'selector resolved no messages',
        },
      ];
    }

    const results: BehaviorActionResult[] = [];
    for (const target of targets) {
      if (target.telegramMessageId === null) {
        results.push({
          actionType: action.type,
          outcome: 'dropped',
          reason: 'target message has no telegram id',
          targetMessageId: target.storedMessageId,
        });
        continue;
      }

      try {
        await this.messenger.reactToMessage(
          context.chatId,
          target.telegramMessageId,
          action.emoji
        );
        results.push({
          actionType: action.type,
          outcome: 'sent',
          reason: null,
          targetMessageId: target.storedMessageId,
          telegramMessageId: target.telegramMessageId,
        });
      } catch (error) {
        results.push({
          ...this.failed(action.type, error),
          targetMessageId: target.storedMessageId,
          telegramMessageId: target.telegramMessageId,
        });
      }
    }

    return results;
  }

  private executeSummarizeThread(
    context: BehaviorDecisionContext,
    action: Extract<BehaviorAction, { type: 'summarize_thread' }>
  ): BehaviorActionResult {
    const result = this.summarizationQueue.enqueueOrBump({
      chatId: context.chatId,
      intent: action.intent,
      reason: action.reason,
      triggerMessageIds: context.triggerMessageIds,
      contextMessageIds: context.contextMessageIds,
      batchMessageIds: context.batchMessageIds,
    });

    return {
      actionType: action.type,
      outcome: result.outcome,
      reason: result.outcome === 'deferred' ? result.reason : null,
    };
  }

  private resolveReplyTarget(
    context: BehaviorDecisionContext,
    target: ReplyTarget
  ):
    | {
        outcome: 'resolved';
        targetMessageId: number | null;
        telegramMessageId: number | null;
      }
    | {
        outcome: 'dropped';
        reason: string;
        targetMessageId?: number;
      } {
    if (target.kind === 'none') {
      return {
        outcome: 'resolved',
        targetMessageId: null,
        telegramMessageId: null,
      };
    }

    const targets = this.resolveSelector(context, target.selector);
    if (targets.length === 0) {
      return { outcome: 'dropped', reason: 'selector resolved no messages' };
    }

    const [resolved] = targets;
    if (resolved.telegramMessageId === null) {
      return {
        outcome: 'dropped',
        reason: 'target message has no telegram id',
        targetMessageId: resolved.storedMessageId,
      };
    }

    return {
      outcome: 'resolved',
      targetMessageId: resolved.storedMessageId,
      telegramMessageId: resolved.telegramMessageId,
    };
  }

  private resolveSelector(
    context: BehaviorDecisionContext,
    selector: MessageSelector | SingleMessageSelector
  ): ResolvedMessageTarget[] {
    const selectedIds = this.selectIds(this.scopeIds(context, selector.scope), selector);
    const messagesById = new Map(
      context.messages.map((message) => [message.id, message])
    );

    return selectedIds.flatMap((id) => {
      const message = messagesById.get(id);
      if (!message) {
        return [];
      }
      return [
        {
          storedMessageId: id,
          telegramMessageId: message.messageId ?? null,
        },
      ];
    });
  }

  private scopeIds(
    context: BehaviorDecisionContext,
    scope: MessageSelector['scope']
  ): number[] {
    switch (scope) {
      case 'trigger':
        return [...context.triggerMessageIds].sort((a, b) => a - b);
      case 'context':
        return [...context.contextMessageIds].sort((a, b) => a - b);
      case 'batch':
        return [...context.batchMessageIds].sort((a, b) => a - b);
    }
  }

  private selectIds(
    ids: readonly number[],
    selector: MessageSelector | SingleMessageSelector
  ): number[] {
    switch (selector.pick) {
      case 'first':
        return ids.length > 0 ? [ids[0]] : [];
      case 'latest':
        return ids.length > 0 ? [ids[ids.length - 1]] : [];
      case 'index':
        return selector.index < ids.length ? [ids[selector.index]] : [];
      case 'all':
        return [...ids];
    }
  }

  private formatQuestion(
    action: Extract<BehaviorAction, { type: 'ask_question' }>
  ): string {
    if (!action.targetUsername) {
      return action.text;
    }

    const mention = action.targetUsername.startsWith('@')
      ? action.targetUsername
      : `@${action.targetUsername}`;
    return `${mention} ${action.text}`;
  }

  private failed(
    actionType: BehaviorAction['type'],
    error: unknown
  ): BehaviorActionResult {
    return {
      actionType,
      outcome: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
