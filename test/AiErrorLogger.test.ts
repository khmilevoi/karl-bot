import { describe, expect, it, vi } from 'vitest';

import { DefaultAiErrorLogger } from '../src/application/behavior/DefaultAiErrorLogger';
import type { AiErrorEventRepository } from '../src/domain/repositories/AiErrorEventRepository';

describe('DefaultAiErrorLogger', () => {
  it('calls repo.insert with correct fields and status: open', async () => {
    const repo: AiErrorEventRepository = {
      insert: vi.fn().mockResolvedValue(7),
      findById: vi.fn(),
    } as unknown as AiErrorEventRepository;

    const logger = new DefaultAiErrorLogger(repo);
    const id = await logger.log({
      chatId: 1,
      source: 'behavior_gate_openai',
      severity: 'error',
      errorCode: 'GATE_SCHEMA_FAIL',
      message: 'gate failed',
      component: 'BehaviorPipeline',
      operation: 'evaluateGate',
      fixHint: 'check gate schema',
    });

    expect(id).toBe(7);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 1,
        source: 'behavior_gate_openai',
        severity: 'error',
        status: 'open',
        fixHint: 'check gate schema',
        inputRefJson: null,
        outputRefJson: null,
      })
    );
  });

  it('truncates input/output refs longer than 2000 chars', async () => {
    const repo: AiErrorEventRepository = {
      insert: vi.fn().mockResolvedValue(1),
      findById: vi.fn(),
    } as unknown as AiErrorEventRepository;

    const logger = new DefaultAiErrorLogger(repo);
    const longValue = 'x'.repeat(3000);
    await logger.log({
      chatId: null,
      source: 'test',
      severity: 'warning',
      errorCode: 'TEST',
      message: 'test',
      component: 'test',
      operation: 'test',
      inputRef: longValue,
      fixHint: 'n/a',
    });

    const call = vi.mocked(repo.insert).mock.calls[0][0];
    expect(call.inputRefJson).toBeDefined();
    expect(call.inputRefJson!.length).toBeLessThanOrEqual(2005);
    expect(call.inputRefJson!.endsWith('...')).toBe(true);
  });
});
