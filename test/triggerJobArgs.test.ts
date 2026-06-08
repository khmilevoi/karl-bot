import { describe, expect, it } from 'vitest';

// scripts/ is plain ESM JS (not type-checked by tsc, which excludes test/).
import { parseArgs } from '../scripts/trigger-job.mjs';

describe('trigger-job parseArgs', () => {
  it('rejects an unknown job', () => {
    expect(parseArgs(['nope', '--all']).ok).toBe(false);
  });

  it('requires exactly one of --chat-id or --all', () => {
    expect(parseArgs(['fact-check']).ok).toBe(false);
    expect(parseArgs(['fact-check', '--all', '--chat-id', '1']).ok).toBe(false);
  });

  it('parses a per-chat job', () => {
    expect(parseArgs(['fact-check', '--chat-id', '42'])).toEqual({
      ok: true,
      job: 'fact-check',
      all: false,
      chatId: '42',
      period: null,
    });
  });

  it('parses an all-chats job', () => {
    expect(parseArgs(['topic-of-day', '--all'])).toEqual({
      ok: true,
      job: 'topic-of-day',
      all: true,
      chatId: null,
      period: null,
    });
  });

  it('requires a valid period for fact-check-stats', () => {
    expect(parseArgs(['fact-check-stats', '--all']).ok).toBe(false);
    expect(parseArgs(['fact-check-stats', '--all', '--period', 'yearly']).ok).toBe(false);
    expect(parseArgs(['fact-check-stats', '--all', '--period', 'weekly'])).toEqual({
      ok: true,
      job: 'fact-check-stats',
      all: true,
      chatId: null,
      period: 'weekly',
    });
  });
});
