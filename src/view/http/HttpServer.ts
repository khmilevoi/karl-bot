import type { ServiceIdentifier } from 'inversify';

export interface HttpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const HTTP_SERVER_ID = Symbol.for(
  'HttpServer'
) as ServiceIdentifier<HttpServer>;
