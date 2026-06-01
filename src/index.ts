import http from 'node:http';

import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from './application/interfaces/logging/LoggerFactory';
import { container } from './container';
import { MainService } from './view/telegram/MainService';

const loggerFactory = container.get<LoggerFactory>(LOGGER_FACTORY_ID);
const logger = loggerFactory.create('index');
const main = container.get<MainService>(MainService);

logger.info('Starting application');
void main.launch();

const port = Number(process.env.PORT ?? 3000);

const httpServer = http
  .createServer((_, res) => {
    res.writeHead(200);
    res.end('ok');
  })
  .listen(port, () => logger.info(`HTTP server listening on port ${port}`));

function shutdown(reason: string): void {
  logger.info(`${reason} received`);
  httpServer.close();
  main.stop(reason);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
