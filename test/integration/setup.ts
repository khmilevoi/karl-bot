import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Ensure we are in test mode before loading the container
process.env.NODE_ENV = 'test';
const tmpDbDir = mkdtempSync(join(tmpdir(), 'ark-bot-test-'));
process.env.DATABASE_URL = `file://${join(tmpDbDir, 'test.db')}`;

import { container } from '../../src/container';
import { migrateUp } from '../../src/migrate';
import {
  type AIService,
  AI_SERVICE_ID,
} from '../../src/application/interfaces/ai/AIService';
import type { ChatMessage } from '../../src/domain/messages/ChatMessage';
import type { Context, Telegram } from 'telegraf';

// Stable mock for AIService
class MockAIService implements AIService {
  async summarize(_history: ChatMessage[], _prev?: string): Promise<string> {
    return 'mocked summary';
  }
}

// Stable mock for Telegram API
class MockTelegram implements Partial<Telegram> {
  public sendMessage = async () => ({ message_id: 0 });
  public sendChatAction = async () => {};
  public sendDocument = async () => ({ message_id: 0 });
  public deleteWebhook = async () => {};
  public editMessageText = async () => {};
}

export async function init(): Promise<void> {
  // Run database migrations for the temporary database
  await migrateUp();
  // Replace AI service with mock implementation
  container
    .rebind<AIService>(AI_SERVICE_ID)
    .to(MockAIService)
    .inSingletonScope();
}

export interface MockContextOptions {
  chatId?: number;
  userId?: number;
  text?: string;
}

// Helper to create a Telegram context for tests
export function createContext(options: MockContextOptions = {}): Context {
  const { chatId = 1, userId = 1, text = '' } = options;
  const telegram = new MockTelegram();
  return {
    chat: { id: chatId, type: 'private' } as any,
    from: {
      id: userId,
      is_bot: false,
      first_name: 'user',
      username: 'user',
    } as any,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      from: { id: userId, is_bot: false, first_name: 'user', username: 'user' },
      text,
    } as any,
    telegram: telegram as unknown as Telegram,
    reply: async () => {},
    replyWithDocument: async () => ({ message_id: 0 }),
    answerCbQuery: async () => {},
    sendChatAction: async () => {},
  } as unknown as Context;
}

export { container };
export { MockAIService, MockTelegram };
