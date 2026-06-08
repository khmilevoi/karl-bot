import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import Router from 'find-my-way';
import { inject, injectable } from 'inversify';

import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';

import type { HttpServer } from './HttpServer';
import {
  JOB_CONTROLLER_ID,
  type HttpResult,
  type JobController,
} from './JobController';

// Only the methods we register — used to tell 404 (no such path) from 405
// (path exists under a different method). find-my-way has no built-in 405.
const PROBE_METHODS = ['GET', 'POST'] as const;

@injectable()
export class NodeHttpServer implements HttpServer {
  private readonly logger: Logger;
  private readonly configuredPort: number;
  private readonly router: Router.Instance<Router.HTTPVersion.V1>;
  private server: Server | null = null;

  constructor(
    @inject(JOB_CONTROLLER_ID) private readonly controller: JobController,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('NodeHttpServer');
    this.configuredPort = Number(process.env.PORT ?? 3000);
    this.router = Router({
      ignoreTrailingSlash: true,
      defaultRoute: (req, res) => this.handleUnmatched(req, res),
    });
    this.router.on('GET', '/health', (_req, res) => {
      this.send(res, { status: 200, text: 'ok' });
    });
    this.router.on('POST', '/jobs/:job', (req, res, params) => {
      void this.runJob(req, res, params.job, 'chat');
    });
    this.router.on('POST', '/jobs/:job/all', (req, res, params) => {
      void this.runJob(req, res, params.job, 'all');
    });
  }

  get port(): number | null {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  async start(): Promise<void> {
    const server = http.createServer((req, res) => {
      this.router.lookup(req, res);
    });
    this.server = server;
    await new Promise<void>((resolve) => {
      server.listen(this.configuredPort, () => resolve());
    });
    this.logger.info({ port: this.port }, 'HTTP server listening');
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = null;
  }

  private async runJob(
    req: IncomingMessage,
    res: ServerResponse,
    jobName: string | undefined,
    scope: 'chat' | 'all'
  ): Promise<void> {
    try {
      const rawBody = await this.readBody(req);
      const body = this.parseBody(rawBody);
      if (body === null) {
        this.send(res, {
          status: 400,
          json: { ok: false, error: 'invalid JSON body' },
        });
        return;
      }
      this.send(res, await this.controller.run(jobName ?? '', scope, body));
    } catch (error) {
      this.logger.error({ error, jobName, scope }, 'Job request failed');
      this.send(res, {
        status: 500,
        json: {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // find-my-way calls defaultRoute for any unmatched (method, path). Report 405
  // if the path exists under another method, otherwise 404.
  private handleUnmatched(req: IncomingMessage, res: ServerResponse): void {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const existsForOtherMethod = PROBE_METHODS.some(
      (probe) => probe !== method && this.router.find(probe, pathname) !== null
    );
    this.send(
      res,
      existsForOtherMethod
        ? { status: 405, json: { ok: false, error: 'method not allowed' } }
        : { status: 404, json: { ok: false, error: 'not found' } }
    );
  }

  private send(res: ServerResponse, result: HttpResult): void {
    if (result.text !== undefined) {
      res.writeHead(result.status, { 'content-type': 'text/plain' });
      res.end(result.text);
      return;
    }
    res.writeHead(result.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.json ?? {}));
  }

  private parseBody(rawBody: string): Record<string, unknown> | null {
    if (rawBody.trim().length === 0) return {};
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
}
