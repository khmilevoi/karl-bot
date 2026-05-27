import type { Context } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import type { AIService } from '../src/application/interfaces/ai/AIService';
import type { ChatMessage } from '../src/domain/messages/ChatMessage';
import type { ChatMemoryManager } from '../src/application/interfaces/chat/ChatMemoryManager';
import { ChatResponder } from '../src/application/interfaces/chat/ChatResponder';
import { DefaultChatResponder } from '../src/application/use-cases/chat/DefaultChatResponder';
import type { SummaryService } from '../src/application/interfaces/summaries/SummaryService';
import { TriggerReason } from '../src/domain/triggers/Trigger';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

class MockAIService implements AIService {
  history: ChatMessage[] | undefined;
  summary: string | undefined;
  reason: TriggerReason | undefined;
  async ask(h: ChatMessage[], s?: string, r?: TriggerReason): Promise<string> {
    this.history = h;
    this.summary = s;
    this.reason = r;
    return 'answer';
  }
  async summarize(): Promise<string> {
    return '';
  }
  async checkInterest(): Promise<{ messageId: string; why: string } | null> {
    return null;
  }
  async generateTopicOfDay(): Promise<string> {
    return '';
  }
}

class ThrowingAIService implements AIService {
  async ask(): Promise<string> {
    throw new Error('ask failed');
  }
  async summarize(): Promise<string> {
    return '';
  }
  async checkInterest(): Promise<{ messageId: string; why: string } | null> {
    return null;
  }
  async generateTopicOfDay(): Promise<string> {
    return '';
  }
}

class MockChatMemory {
  messages: ChatMessage[] = [];
  async addMessage(msg: ChatMessage): Promise<void> {
    this.messages.push(msg);
  }
  async getHistory(): Promise<ChatMessage[]> {
    return [...this.messages];
  }
}

class MockChatMemoryManager implements ChatMemoryManager {
  memory = new MockChatMemory();
  async get(_chatId: number): Promise<MockChatMemory> {
    return this.memory;
  }
  async reset(): Promise<void> {}
}

class MockSummaryService implements SummaryService {
  async getSummary(): Promise<string> {
    return '';
  }
  async setSummary(): Promise<void> {}
}

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    }),
  }) as unknown as LoggerFactory;

describe('ChatResponder', () => {
  it('generates answer and stores assistant message', async () => {
    const ai = new MockAIService();
    const memories = new MockChatMemoryManager();
    const summaries = new MockSummaryService();
    const responder: ChatResponder = new DefaultChatResponder(
      ai,
      memories,
      summaries,
      createLoggerFactory()
    );

    const mem1 = await memories.get(1);
    await mem1.addMessage({ role: 'user', content: 'hi' });
    const ctx = {
      me: { username: 'bot' },
      chat: { id: 1 },
    } as unknown as Context;

    const answer = await responder.generate(ctx, 1, {
      why: 'why',
      message: 'hi',
    });
    expect(answer).toBe('answer');
    expect(ai.history).toHaveLength(1);
    expect(ai.reason).toEqual({ why: 'why', message: 'hi' });
    expect(memories.memory.messages).toHaveLength(2);
    expect(memories.memory.messages[1].role).toBe('assistant');
    expect(memories.memory.messages[1].content).toBe('answer');
  });

  it('propagates errors from AI service and does not store message', async () => {
    const ai = new ThrowingAIService();
    const memories = new MockChatMemoryManager();
    const summaries = new MockSummaryService();
    const responder: ChatResponder = new DefaultChatResponder(
      ai,
      memories,
      summaries,
      createLoggerFactory()
    );

    const mem2 = await memories.get(1);
    await mem2.addMessage({ role: 'user', content: 'hi' });
    const ctx = {
      me: { username: 'bot' },
      chat: { id: 1 },
    } as unknown as Context;

    await expect(responder.generate(ctx, 1)).rejects.toThrow('ask failed');
    expect(memories.memory.messages).toHaveLength(1);
  });

  it('works without history or summary', async () => {
    const ai = new MockAIService();
    const memories = new MockChatMemoryManager();
    const summaries = new MockSummaryService();
    const responder: ChatResponder = new DefaultChatResponder(
      ai,
      memories,
      summaries,
      createLoggerFactory()
    );
    const ctx = {
      me: { username: 'bot' },
      chat: { id: 1 },
    } as unknown as Context;

    const answer = await responder.generate(ctx, 1);
    expect(answer).toBe('answer');
    expect(ai.history).toEqual([]);
    expect(ai.summary).toBe('');
    expect(memories.memory.messages).toHaveLength(1);
    expect(memories.memory.messages[0].role).toBe('assistant');
  });
});
