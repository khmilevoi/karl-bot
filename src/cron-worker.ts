import 'reflect-metadata';

import { Container } from 'inversify';

import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from './application/interfaces/logging/LoggerFactory';
import {
  CRON_WORKER_ID,
  type CronWorker,
} from './application/scheduler/CronWorker';
import { register as registerApplication } from './container/application';
import { registerCronWorker } from './container/cron-worker';
import { register as registerRepositories } from './container/repositories';

const container = new Container();
registerRepositories(container);
registerApplication(container);
registerCronWorker(container);

const loggerFactory = container.get<LoggerFactory>(LOGGER_FACTORY_ID);
const logger = loggerFactory.create('cron-worker');
const worker = container.get<CronWorker>(CRON_WORKER_ID);

logger.info('Starting cron worker');
worker.start();

function shutdown(reason: string): void {
  logger.info(`${reason} received`);
  worker.stop();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
