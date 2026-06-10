import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DefaultEnvService } from '../src/infrastructure/config/DefaultEnvService';

const BASE_ENV = {
  BOT_TOKEN: 'x',
  OPENAI_KEY: 'x',
  DATABASE_URL: 'file:///tmp/x.db',
  ADMIN_CHAT_ID: '0',
};

describe('getCronWorkerConfig', () => {
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    process.env = { ...BASE_ENV } as NodeJS.ProcessEnv;
  });

  afterEach(() => {
    process.env = saved;
  });

  it('exposes scheduler defaults and reused cron expressions', () => {
    const config = new DefaultEnvService().getCronWorkerConfig();
    expect(config.jobsBaseUrl).toBe('http://localhost:3000');
    expect(config.hourlyCron).toBe('0 0 * * * *');
    expect(config.sweepCron).toBe('0 */3 * * *');
    expect(config.timezone).toBe('Europe/Warsaw');
    expect(config.maxAttempts).toBe(5);
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.reconcileIntervalMs).toBe(60000);
    expect(config.lockMs).toBe(600000);
    expect(config.backoffBaseMs).toBe(30000);
    expect(config.jobRequestTimeoutMs).toBe(600000);
  });

  it('overrides from env', () => {
    process.env.JOBS_BASE_URL = 'http://app:3000';
    process.env.SCHEDULER_MAX_ATTEMPTS = '7';
    const config = new DefaultEnvService().getCronWorkerConfig();
    expect(config.jobsBaseUrl).toBe('http://app:3000');
    expect(config.maxAttempts).toBe(7);
  });
});
