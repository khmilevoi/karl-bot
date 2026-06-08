import 'reflect-metadata';

import { Container } from 'inversify';

import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from './application/interfaces/logging/LoggerFactory';
import {
  AUDIO_TRANSCRIPTION_WORKER_ID,
  type AudioTranscriptionWorker,
} from './application/interfaces/voice/AudioTranscriptionWorker';
import { register as registerRepositories } from './container/repositories';
import { register as registerApplication } from './container/application';

const workerContainer = new Container();
registerRepositories(workerContainer);
registerApplication(workerContainer);

const loggerFactory = workerContainer.get<LoggerFactory>(LOGGER_FACTORY_ID);
const logger = loggerFactory.create('audio-worker');
const worker = workerContainer.get<AudioTranscriptionWorker>(
  AUDIO_TRANSCRIPTION_WORKER_ID
);

logger.info('Starting audio transcription worker');
worker.start();

function shutdown(reason: string): void {
  logger.info(`${reason} received`);
  worker.stop();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
