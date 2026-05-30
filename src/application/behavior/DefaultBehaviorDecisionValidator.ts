import { inject, injectable } from 'inversify';

import type {
  BehaviorAction,
  MessageSelector,
} from '@/domain/behavior/schemas/actions';
import type { BehaviorDecision } from '@/domain/behavior/schemas/decision';
import { behaviorDecisionSchema } from '@/domain/behavior/schemas/decision';

import type {
  BehaviorDecisionValidationResult,
  BehaviorDecisionValidator,
  BehaviorDecisionValidatorConfig,
  DroppedAction,
} from './BehaviorDecisionValidator';
import { BEHAVIOR_DECISION_VALIDATOR_CONFIG_ID } from './BehaviorConfig';

function selectorKey(selector: MessageSelector): string {
  return `${selector.scope}:${selector.pick}:${selector.index ?? ''}`;
}

@injectable()
export class DefaultBehaviorDecisionValidator implements BehaviorDecisionValidator {
  constructor(
    @inject(BEHAVIOR_DECISION_VALIDATOR_CONFIG_ID)
    private readonly config: BehaviorDecisionValidatorConfig
  ) {}

  validate(raw: unknown): BehaviorDecisionValidationResult {
    const parsed = behaviorDecisionSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        errorCode: 'behavior_decision_validation',
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`
        ),
      };
    }

    const decision = parsed.data;
    const kept: BehaviorAction[] = [];
    const dropped: DroppedAction[] = [];
    const seenSingleActionTypes = new Set<'reply' | 'ask_question'>();
    const seenReactionTargets = new Set<string>();

    for (const action of decision.actions) {
      const drop = (reason: string): void => {
        dropped.push({ action, reason });
      };

      switch (action.type) {
        case 'summarize_thread': {
          // Internal, not visible; never counts against per-type limits.
          kept.push(action);
          break;
        }
        case 'reply': {
          if (seenSingleActionTypes.has('reply')) {
            drop('duplicate reply action dropped');
            break;
          }
          if (action.text.length === 0) {
            drop('reply text is empty');
            break;
          }
          if (action.text.length > this.config.maxReplyLength) {
            drop(`reply text exceeds max length ${this.config.maxReplyLength}`);
            break;
          }
          seenSingleActionTypes.add('reply');
          kept.push(action);
          break;
        }
        case 'react': {
          if (!this.config.allowedEmoji.includes(action.emoji)) {
            drop(`emoji "${action.emoji}" not in allowed set`);
            break;
          }
          const key = selectorKey(action.target);
          if (seenReactionTargets.has(key)) {
            drop('duplicate react target dropped');
            break;
          }
          seenReactionTargets.add(key);
          kept.push(action);
          break;
        }
        case 'ask_question': {
          if (seenSingleActionTypes.has('ask_question')) {
            drop('duplicate ask_question action dropped');
            break;
          }
          if (action.text.length === 0) {
            drop('ask_question text is empty');
            break;
          }
          seenSingleActionTypes.add('ask_question');
          kept.push(action);
          break;
        }
      }
    }

    const sanitized: BehaviorDecision = { ...decision, actions: kept };
    return { ok: true, decision: sanitized, droppedActions: dropped };
  }
}
