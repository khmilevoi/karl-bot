import { describe, expect, it } from 'vitest';

import {
  canConfirmFinding,
  getSourcePolicyForCategory,
} from '../src/application/fact-checking/FactCheckSourcePolicy';

describe('FactCheckSourcePolicy', () => {
  it('returns primary_required for medical', () => {
    expect(getSourcePolicyForCategory('medical')).toBe('primary_required');
    expect(getSourcePolicyForCategory('legal')).toBe('primary_required');
    expect(getSourcePolicyForCategory('financial')).toBe('primary_required');
    expect(getSourcePolicyForCategory('safety')).toBe('primary_required');
  });

  it('returns chat_history_only for chat_history', () => {
    expect(getSourcePolicyForCategory('chat_history')).toBe(
      'chat_history_only'
    );
  });

  it('returns reliable_or_media_allowed for external_fact and mixed', () => {
    expect(getSourcePolicyForCategory('external_fact')).toBe(
      'reliable_or_media_allowed'
    );
    expect(getSourcePolicyForCategory('mixed')).toBe(
      'reliable_or_media_allowed'
    );
  });

  it('rejects when sourceRequirementsMet is false', () => {
    expect(
      canConfirmFinding({
        category: 'medical',
        sourcePolicy: 'primary_required',
        sourceRequirementsMet: false,
        sources: [{ reliability: 'media' }],
      })
    ).toBe(false);
  });

  it('confirms external_fact with media source', () => {
    expect(
      canConfirmFinding({
        category: 'external_fact',
        sourcePolicy: 'reliable_or_media_allowed',
        sourceRequirementsMet: true,
        sources: [{ reliability: 'media' }],
      })
    ).toBe(true);
  });

  it('confirms chat_history with no sources', () => {
    expect(
      canConfirmFinding({
        category: 'chat_history',
        sourcePolicy: 'chat_history_only',
        sourceRequirementsMet: true,
        sources: [],
      })
    ).toBe(true);
  });

  it('rejects medical with only media source', () => {
    expect(
      canConfirmFinding({
        category: 'medical',
        sourcePolicy: 'primary_required',
        sourceRequirementsMet: true,
        sources: [{ reliability: 'media' }],
      })
    ).toBe(false);
  });

  it('confirms medical with primary source', () => {
    expect(
      canConfirmFinding({
        category: 'medical',
        sourcePolicy: 'primary_required',
        sourceRequirementsMet: true,
        sources: [{ reliability: 'primary' }],
      })
    ).toBe(true);
  });
});
