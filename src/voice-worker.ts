import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from './application/interfaces/logging/LoggerFactory';
import {
  VOICE_MESSAGE_WORKER_ID,
  type VoiceMessageWorker,
} from './application/interfaces/voice/VoiceMessageWorker';
import { container } from './container';

const loggerFactory = container.get<LoggerFactory>(LOGGER_FACTORY_ID);
const logger = loggerFactory.create('voice-worker');
const worker = container.get<VoiceMessageWorker>(VOICE_MESSAGE_WORKER_ID);

logger.info('Starting voice worker');
worker.start();

function shutdown(reason: string): void {
  logger.info(`${reason} received`);
  worker.stop();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
