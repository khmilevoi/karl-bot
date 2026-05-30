import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnvService } from '../src/application/interfaces/env/EnvService';

describe('logger', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.resetModules();
  });

  it('creates logger instance', async () => {
    const { PinoLogger } =
      await import('../src/infrastructure/logging/PinoLogger');
    const logger = new PinoLogger();
    expect(logger).toBeDefined();
  });

  it('creates logger via service', async () => {
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    const { container } = await import('../src/container');
    const LoggerModule =
      await import('../src/application/interfaces/logging/LoggerFactory');
    const factory = container.get<LoggerModule.LoggerFactory>(
      LoggerModule.LOGGER_FACTORY_ID
    );
    const logger = factory.create('LoggerTest');
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    const child = logger.child({ service: 'test' });
    child.info('child');
    expect(typeof child.info).toBe('function');
  }, 10_000);

  it('child logger respects EnvService log level', async () => {
    process.env.LOG_LEVEL = 'info';
    const { PinoLogger } =
      await import('../src/infrastructure/logging/PinoLogger');
    const envService = { env: { LOG_LEVEL: 'error' } } as unknown as EnvService;
    const logger = new PinoLogger(envService);
    const child = logger.child({ service: 'test' });
    expect((child as any).logger.level).toBe('error');
  });
});
