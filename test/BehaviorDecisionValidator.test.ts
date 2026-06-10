import { describe, expect, it } from 'vitest';

import type { BehaviorDecisionValidatorConfig } from '../src/application/behavior/BehaviorDecisionValidator';
import { DefaultBehaviorDecisionValidator } from '../src/application/behavior/DefaultBehaviorDecisionValidator';

const config = { maxReplyLength: 20, allowedEmoji: ['👍', '👎'] };
const validator = new DefaultBehaviorDecisionValidator(config);
const leakGuardConfig: BehaviorDecisionValidatorConfig = {
  maxReplyLength: 4000,
  allowedEmoji: ['🔥'],
};

function decision(actions: unknown[]): unknown {
  return { confidence: 0.8, actions, statePatches: [], safetyNotes: [] };
}

describe('DefaultBehaviorDecisionValidator', () => {
  it('rejects non-object / invalid JSON shapes', () => {
    const result = validator.validate('not an object');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('behavior_decision_validation');
    }
  });

  it('accepts a valid decision with no drops', () => {
    const result = validator.validate(
      decision([
        {
          type: 'reply',
          intent: 'banter',
          text: 'hi',
          target: { kind: 'none' },
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(1);
      expect(result.droppedActions.length).toBe(0);
    }
  });

  it('drops a reply whose text exceeds maxReplyLength', () => {
    const result = validator.validate(
      decision([
        {
          type: 'reply',
          intent: 'banter',
          text: 'x'.repeat(50),
          target: { kind: 'none' },
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(0);
      expect(result.droppedActions[0]?.reason).toContain('length');
    }
  });

  it('drops an empty reply', () => {
    const result = validator.validate(
      decision([
        {
          type: 'reply',
          intent: 'banter',
          text: '',
          target: { kind: 'none' },
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(0);
    }
  });

  it('accepts a reply that targets a single semantic message selector', () => {
    const result = validator.validate(
      decision([
        {
          type: 'reply',
          intent: 'direct_answer',
          text: 'answer',
          target: {
            kind: 'message',
            selector: { scope: 'batch', pick: 'index', index: 0 },
          },
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(1);
      expect(result.droppedActions.length).toBe(0);
    }
  });

  it('drops a react with a disallowed emoji', () => {
    const result = validator.validate(
      decision([
        {
          type: 'react',
          intent: 'approval',
          emoji: '🔥',
          target: { scope: 'batch', pick: 'latest', index: null },
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(0);
      expect(result.droppedActions[0]?.reason).toContain('emoji');
    }
  });

  it('keeps multiple react actions for different semantic targets', () => {
    const result = validator.validate(
      decision([
        {
          type: 'react',
          intent: 'approval',
          emoji: '👍',
          target: { scope: 'batch', pick: 'index', index: 0 },
        },
        {
          type: 'react',
          intent: 'acknowledgement',
          emoji: '👎',
          target: { scope: 'batch', pick: 'index', index: 1 },
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(2);
      expect(result.droppedActions.length).toBe(0);
    }
  });

  it('drops duplicate react actions for the same semantic target', () => {
    const result = validator.validate(
      decision([
        {
          type: 'react',
          intent: 'approval',
          emoji: '👍',
          target: { scope: 'trigger', pick: 'latest', index: null },
        },
        {
          type: 'react',
          intent: 'acknowledgement',
          emoji: '👎',
          target: { scope: 'trigger', pick: 'latest', index: null },
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(1);
      expect(result.droppedActions[0]?.reason).toContain('duplicate');
    }
  });

  it('keeps the first action of a type and drops duplicates', () => {
    const result = validator.validate(
      decision([
        {
          type: 'reply',
          intent: 'banter',
          text: 'one',
          target: { kind: 'none' },
        },
        {
          type: 'reply',
          intent: 'argument',
          text: 'two',
          target: { kind: 'none' },
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(1);
      const reply = result.decision.actions[0];
      expect(reply?.type === 'reply' ? reply.text : '').toBe('one');
      expect(result.droppedActions[0]?.reason).toContain('duplicate');
    }
  });

  it('does not count summarize_thread against visible-action limits', () => {
    const result = validator.validate(
      decision([
        {
          type: 'summarize_thread',
          intent: 'compress_context',
          reason: 'long',
        },
        {
          type: 'reply',
          intent: 'support',
          text: 'ok',
          target: { kind: 'none' },
        },
      ])
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.actions.length).toBe(2);
    }
  });
});

describe('DefaultBehaviorDecisionValidator leak guard', () => {
  it('strips rendered reference tags from reply text', () => {
    const leakGuardValidator = new DefaultBehaviorDecisionValidator(
      leakGuardConfig
    );
    const result = leakGuardValidator.validate(
      decision([
        {
          type: 'reply',
          intent: 'banter',
          text: 'Про Даниила [#3] [userId:464151358] [role:user] вот так',
          target: { kind: 'none' },
        },
      ])
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const [action] = result.decision.actions;
      expect(action.type).toBe('reply');
      if (action.type === 'reply') {
        expect(action.text).not.toContain('[#3]');
        expect(action.text).not.toContain('[userId:');
        expect(action.text).not.toContain('[role:');
        expect(action.text).toContain('Про Даниила');
        expect(action.text).toContain('вот так');
      }
    }
  });

  it('keeps normal text with a hashtag untouched', () => {
    const leakGuardValidator = new DefaultBehaviorDecisionValidator(
      leakGuardConfig
    );
    const result = leakGuardValidator.validate(
      decision([
        {
          type: 'reply',
          intent: 'banter',
          text: 'лучший #1 в чате',
          target: { kind: 'none' },
        },
      ])
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.decision.actions[0].type === 'reply') {
      expect(result.decision.actions[0].text).toBe('лучший #1 в чате');
    }
  });
});
