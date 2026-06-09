import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'fs/promises';

import type {
  EnvService,
  PromptFiles,
} from '../src/application/interfaces/env/EnvService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { FilePromptTemplateService } from '../src/infrastructure/external/FilePromptTemplateService';

describe('FilePromptTemplateService', () => {
  let service: FilePromptTemplateService;

  beforeEach(() => {
    const files: PromptFiles = {
      askSummary: '',
      summarizationSystem: '',
      previousSummary: '',
      userPrompt: '',
      userPromptSystem: '',
      chatUser: '',
      priorityRulesSystem: '',
      neutralCore: '/neutral.md',
      behaviorGateSystem: '',
      behaviorDecisionSystem: '',
      personalityState: '',
      politicalState: '',
      userProfiles: '',
      truths: '',
      behaviorMessages: '',
      stateEvolutionSystem: '',
      personalitySignals: '',
      userPoliticalProfiles: '',
    };
    const env: EnvService = {
      env: {} as any,
      getModels: vi.fn() as any,
      getPromptFiles: () => files,
      getBotName: vi.fn() as any,
      getDialogueTimeoutMs: vi.fn() as any,
      getMigrationsDir: vi.fn() as any,
    } as unknown as EnvService;
    const loggerFactory: LoggerFactory = {
      create: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      }),
    } as unknown as LoggerFactory;
    service = new FilePromptTemplateService(env, loggerFactory);
    vi.mocked(readFile).mockClear();
  });

  it('reads template from file and caches result', async () => {
    vi.mocked(readFile).mockResolvedValue('hello');

    await expect(service.loadTemplate('neutralCore')).resolves.toBe('hello');
    await expect(service.loadTemplate('neutralCore')).resolves.toBe('hello');

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith('/neutral.md', 'utf-8');
  });
});
