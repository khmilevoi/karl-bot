import { describe, expect, it, vi } from 'vitest';

import { JobController } from '../src/view/http/JobController';
import type { JobRunner } from '../src/application/interfaces/scheduler/JobRunner';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const loggerFactory = {
  create: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
} as unknown as LoggerFactory;

function makeController(runner: Partial<JobRunner>) {
  return new JobController(runner as JobRunner, loggerFactory);
}

describe('JobController', () => {
  it('returns 404 for an unknown job name', async () => {
    const controller = makeController({ runForChat: vi.fn() });
    const res = await controller.run('nope', 'chat', {});
    expect(res.status).toBe(404);
  });

  it('returns 400 when chatId is missing for a per-chat job', async () => {
    const controller = makeController({ runForChat: vi.fn() });
    const res = await controller.run('fact-check', 'chat', {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when chatId is not an integer', async () => {
    const controller = makeController({ runForChat: vi.fn() });
    const res = await controller.run('fact-check', 'chat', { chatId: 1.5 });
    expect(res.status).toBe(400);
  });

  it('runs a per-chat job and wraps the result with ok:true', async () => {
    const runForChat = vi.fn(async () => ({
      job: 'fact-check',
      chatId: 5,
      outcome: 'completed',
      factCheck: {
        chatId: 5,
        outcome: 'completed',
        runId: 1,
        processedMessages: 0,
        persistedFindings: 0,
      },
    }));
    const controller = makeController({ runForChat: runForChat as never });
    const res = await controller.run('fact-check', 'chat', { chatId: 5 });
    expect(runForChat).toHaveBeenCalledWith({ job: 'fact-check', chatId: 5 });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, job: 'fact-check', chatId: 5 });
  });

  it('requires a valid period for fact-check-stats (per-chat)', async () => {
    const controller = makeController({ runForChat: vi.fn() });
    const res = await controller.run('fact-check-stats', 'chat', { chatId: 5 });
    expect(res.status).toBe(400);
  });

  it('runs fact-check-stats per-chat with a period', async () => {
    const runForChat = vi.fn(async () => ({
      job: 'fact-check-stats',
      chatId: 5,
      period: 'weekly',
      outcome: 'completed',
      factCheck: {
        chatId: 5,
        outcome: 'completed',
        runId: 1,
        processedMessages: 0,
        persistedFindings: 0,
      },
    }));
    const controller = makeController({ runForChat: runForChat as never });
    const res = await controller.run('fact-check-stats', 'chat', {
      chatId: 5,
      period: 'weekly',
    });
    expect(runForChat).toHaveBeenCalledWith({
      job: 'fact-check-stats',
      chatId: 5,
      period: 'weekly',
    });
    expect(res.status).toBe(200);
  });

  it('runs an all-chats job', async () => {
    const runForAllChats = vi.fn(async () => ({
      job: 'fact-check',
      scope: 'all',
      totalChats: 0,
      results: [],
    }));
    const controller = makeController({
      runForAllChats: runForAllChats as never,
    });
    const res = await controller.run('fact-check', 'all', {});
    expect(runForAllChats).toHaveBeenCalledWith({ job: 'fact-check' });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, scope: 'all' });
  });

  it('requires a period for fact-check-stats all-chats', async () => {
    const controller = makeController({ runForAllChats: vi.fn() });
    const res = await controller.run('fact-check-stats', 'all', {});
    expect(res.status).toBe(400);
  });

  it('returns 500 when the runner throws', async () => {
    const controller = makeController({
      runForChat: vi.fn(async () => {
        throw new Error('kaboom');
      }),
    });
    const res = await controller.run('fact-check', 'chat', { chatId: 5 });
    expect(res.status).toBe(500);
    expect(res.json).toMatchObject({ ok: false });
  });
});
