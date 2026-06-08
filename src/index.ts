import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from './application/interfaces/logging/LoggerFactory';
import { container } from './container';
import { HTTP_SERVER_ID, type HttpServer } from './view/http/HttpServer';
import { MainService } from './view/telegram/MainService';

const loggerFactory = container.get<LoggerFactory>(LOGGER_FACTORY_ID);
const logger = loggerFactory.create('index');
const main = container.get<MainService>(MainService);
const httpServer = container.get<HttpServer>(HTTP_SERVER_ID);

logger.info('Starting application');
void main.launch();
void httpServer.start();

function shutdown(reason: string): void {
  logger.info(`${reason} received`);
  void httpServer.stop();
  main.stop(reason);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
