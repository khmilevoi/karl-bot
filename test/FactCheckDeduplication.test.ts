import { describe, expect, it } from 'vitest';

import { normalizeClaimKey } from '../src/application/fact-checking/FactCheckDeduplication';

describe('FactCheckDeduplication', () => {
  it('lowercases and trims', () => {
    expect(normalizeClaimKey('  Hello World  ')).toBe('hello world');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeClaimKey('hello   world')).toBe('hello world');
  });

  it('strips trailing punctuation', () => {
    expect(normalizeClaimKey('The euro was introduced in 2000.')).toBe(
      'the euro was introduced in 2000'
    );
    expect(normalizeClaimKey('Is this true?')).toBe('is this true');
    expect(normalizeClaimKey('Stop!')).toBe('stop');
  });

  it('produces stable keys for equivalent claims', () => {
    const a = normalizeClaimKey('  The euro was introduced in 2000.  ');
    const b = normalizeClaimKey('The euro was introduced in 2000');
    expect(a).toBe(b);
  });
});
