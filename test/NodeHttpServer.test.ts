import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeHttpServer } from '../src/view/http/NodeHttpServer';
import type { HttpResult, JobController } from '../src/view/http/JobController';
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

function makeController(run: (...args: unknown[]) => Promise<HttpResult>): JobController {
  return { run } as unknown as JobController;
}

describe('NodeHttpServer', () => {
  const originalPort = process.env.PORT;
  let server: NodeHttpServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    process.env.PORT = originalPort;
  });

  it('routes a per-chat POST to the controller with the parsed body', async () => {
    process.env.PORT = '0';
    const run = vi.fn(async (): Promise<HttpResult> => ({ status: 200, json: { ok: true, echoed: true } }));
    server = new NodeHttpServer(makeController(run), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/jobs/fact-check`, {
      method: 'POST',
      body: JSON.stringify({ chatId: 1 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, echoed: true });
    expect(run).toHaveBeenCalledWith('fact-check', 'chat', { chatId: 1 });
  });

  it('routes an all-chats POST with an empty body to the controller', async () => {
    process.env.PORT = '0';
    const run = vi.fn(async (): Promise<HttpResult> => ({ status: 200, json: { ok: true } }));
    server = new NodeHttpServer(makeController(run), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/jobs/fact-check/all`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith('fact-check', 'all', {});
  });

  it('serves GET /health as text without touching the controller', async () => {
    process.env.PORT = '0';
    const run = vi.fn();
    server = new NodeHttpServer(makeController(run as never), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('ok');
    expect(run).not.toHaveBeenCalled();
  });

  it('returns 405 for a known path with the wrong method', async () => {
    process.env.PORT = '0';
    server = new NodeHttpServer(makeController(vi.fn() as never), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/jobs/fact-check`, { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('returns 404 for an unknown path', async () => {
    process.env.PORT = '0';
    server = new NodeHttpServer(makeController(vi.fn() as never), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/nope`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an invalid JSON body without calling the controller', async () => {
    process.env.PORT = '0';
    const run = vi.fn();
    server = new NodeHttpServer(makeController(run as never), loggerFactory);
    await server.start();

    const res = await fetch(`http://127.0.0.1:${server.port}/jobs/fact-check`, {
      method: 'POST',
      body: '{not json',
    });

    expect(res.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
