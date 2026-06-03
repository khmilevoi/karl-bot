import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteAccessKeyRepository } from '../src/infrastructure/persistence/sqlite/SQLiteAccessKeyRepository';
import { SQLiteChatRepository } from '../src/infrastructure/persistence/sqlite/SQLiteChatRepository';
import { SQLiteChatUserRepository } from '../src/infrastructure/persistence/sqlite/SQLiteChatUserRepository';
import { SQLiteMessageRepository } from '../src/infrastructure/persistence/sqlite/SQLiteMessageRepository';
import { SQLiteSummaryRepository } from '../src/infrastructure/persistence/sqlite/SQLiteSummaryRepository';
import { SQLiteUserRepository } from '../src/infrastructure/persistence/sqlite/SQLiteUserRepository';
import { ChatEntity } from '../src/domain/entities/ChatEntity';
import { UserEntity } from '../src/domain/entities/UserEntity';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import { parseDatabaseUrl } from '../src/utils/database';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => {
      const logger = {
        debug() {},
        info() {},
        warn() {},
        error() {},
        child() {
          return logger;
        },
      };
      return logger;
    },
  }) as unknown as LoggerFactory;

let chatRepo: SQLiteChatRepository;
let userRepo: SQLiteUserRepository;
let messageRepo: SQLiteMessageRepository;
let summaryRepo: SQLiteSummaryRepository;
let accessKeyRepo: SQLiteAccessKeyRepository;
let chatUserRepo: SQLiteChatUserRepository;
let dbFile: string;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sqlite-'));
  dbFile = path.join(dir, 'test.db');
  process.env.DATABASE_URL = `file://${dbFile}`;
  const env = new TestEnvService();
  const filename = parseDatabaseUrl(env.env.DATABASE_URL);
  const db = await open({ filename, driver: sqlite3.Database });
  await db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT
      );
      CREATE TABLE chats (
        chat_id INTEGER PRIMARY KEY,
        title TEXT
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        message_id INTEGER,
        role TEXT,
        content TEXT,
        user_id INTEGER NOT NULL,
        reply_text TEXT,
        reply_username TEXT,
        quote_text TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        source_type TEXT NOT NULL DEFAULT 'text',
        processing_status TEXT NOT NULL DEFAULT 'ready',
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(chat_id) REFERENCES chats(chat_id)
      );
      CREATE TABLE summaries (
        chat_id INTEGER PRIMARY KEY,
        summary TEXT
      );
      CREATE TABLE access_keys (
        chat_id INTEGER,
        user_id INTEGER,
        access_key TEXT,
        expires_at INTEGER,
        PRIMARY KEY(chat_id, user_id)
      );
      CREATE TABLE chat_users (
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (chat_id, user_id),
        FOREIGN KEY(chat_id) REFERENCES chats(chat_id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);
  await db.close();
  const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
  chatRepo = new SQLiteChatRepository(provider);
  userRepo = new SQLiteUserRepository(provider);
  messageRepo = new SQLiteMessageRepository(provider);
  summaryRepo = new SQLiteSummaryRepository(provider);
  accessKeyRepo = new SQLiteAccessKeyRepository(provider);
  chatUserRepo = new SQLiteChatUserRepository(provider);
});

describe('SQLite repositories', () => {
  it('adds and retrieves messages', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(1, 'alice', 'Alice', 'Smith'));
    const firstId = await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: 'hi',
      userId: 1,
      messageId: 11,
    });
    expect(firstId).toBe(1);
    await userRepo.upsert(new UserEntity(0, 'bot'));
    const secondId = await messageRepo.insert({
      chatId: 1,
      role: 'assistant',
      content: 'hello',
      userId: 0,
    });
    expect(secondId).toBe(2);
    const messages = await messageRepo.findByChatId(1);
    expect(messages).toEqual([
      {
        id: 1,
        role: 'user',
        content: 'hi',
        username: 'alice',
        fullName: 'Alice Smith',
        firstName: 'Alice',
        lastName: 'Smith',
        userId: 1,
        messageId: 11,
        chatId: 1,
        sourceType: 'text',
        processingStatus: 'ready',
      },
      {
        id: 2,
        role: 'assistant',
        content: 'hello',
        username: 'bot',
        chatId: 1,
        sourceType: 'text',
        processingStatus: 'ready',
      },
    ]);
    const byIds = await messageRepo.findByIds([secondId, firstId]);
    expect(byIds.map((m) => m.id)).toEqual([firstId, secondId]);
  });

  it('counts and retrieves last messages', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(1, 'alice'));
    await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: 'hi',
      userId: 1,
    });
    await userRepo.upsert(new UserEntity(0, 'bot'));
    await messageRepo.insert({
      chatId: 1,
      role: 'assistant',
      content: 'hello',
      userId: 0,
    });
    expect(await messageRepo.countByChatId(1)).toBe(2);
    const last = await messageRepo.findLastByChatId(1, 1);
    expect(last).toEqual([
      {
        id: 2,
        role: 'assistant',
        content: 'hello',
        username: 'bot',
        chatId: 1,
        sourceType: 'text',
        processingStatus: 'ready',
      },
    ]);
  });

  it('soft-deletes messages from normal history while preserving id lookup', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(1, 'alice'));
    const messageId = await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: 'hi',
      userId: 1,
    });
    await messageRepo.clearByChatId(1);

    const db = await open({ filename: dbFile, driver: sqlite3.Database });
    const row = await db.get<{ is_active: number }>(
      'SELECT is_active FROM messages WHERE id = ?',
      messageId
    );
    await db.close();

    expect(row).toEqual({ is_active: 0 });
    const messages = await messageRepo.findByChatId(1);
    expect(messages).toEqual([]);
    expect(await messageRepo.countByChatId(1)).toBe(0);
    expect(await messageRepo.findLastByChatId(1, 1)).toEqual([]);
    expect(await messageRepo.findByIds([messageId])).toEqual([]);
  });

  it('stores and retrieves summary', async () => {
    await summaryRepo.upsert(1, 'summary');
    expect(await summaryRepo.findById(1)).toBe('summary');
  });

  it('resets messages and summary', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(1, 'alice'));
    await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: 'hi',
      userId: 1,
    });
    await summaryRepo.upsert(1, 'summary');
    await messageRepo.clearByChatId(1);
    await summaryRepo.clearByChatId(1);
    const messages = await messageRepo.findByChatId(1);
    expect(messages).toEqual([]);
    expect(await summaryRepo.findById(1)).toBe('');
  });

  it('stores and updates users', async () => {
    await userRepo.upsert(new UserEntity(42, 'alice', 'Alice', 'Smith'));
    const user = new UserEntity(42, 'alice2', 'Alicia', 'Johnson');
    await userRepo.upsert(user);
    const fetched = await userRepo.findById(42);
    expect(fetched).toEqual(user);
  });

  it('stores chats', async () => {
    await chatRepo.upsert(new ChatEntity(1, 'Test Chat'));
    const chat = await chatRepo.findById(1);
    expect(chat).toEqual(new ChatEntity(1, 'Test Chat'));
  });

  it('links users to chats and lists them', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(2, 'bob'));
    await userRepo.upsert(new UserEntity(3, 'carol'));
    await chatUserRepo.link(1, 2);
    await chatUserRepo.link(1, 3);
    expect(await chatUserRepo.listByChat(1)).toEqual([2, 3]);
  });

  it('does not return pending voice messages in normal history reads', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(1, 'alice'));
    const pendingId = await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: '[voice:pending]',
      userId: 1,
      sourceType: 'voice',
      processingStatus: 'pending',
    });
    const readyId = await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: 'ready',
      userId: 1,
    });

    expect(await messageRepo.findByChatId(1)).toEqual([
      expect.objectContaining({ id: readyId, content: 'ready' }),
    ]);
    expect(await messageRepo.countByChatId(1)).toBe(1);
    expect(await messageRepo.findLastByChatId(1, 10)).toEqual([
      expect.objectContaining({ id: readyId, content: 'ready' }),
    ]);
    expect(await messageRepo.findByIds([pendingId, readyId])).toEqual([
      expect.objectContaining({ id: readyId, content: 'ready' }),
    ]);
  });

  it('marks pending voice messages ready with transcript', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(1, 'alice'));
    const id = await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: '[voice:pending]',
      userId: 1,
      sourceType: 'voice',
      processingStatus: 'pending',
    });

    const updated = await messageRepo.markVoiceTranscribed(id, '[voice] hello');

    expect(updated).toEqual(
      expect.objectContaining({
        id,
        content: '[voice] hello',
        sourceType: 'voice',
        processingStatus: 'ready',
      })
    );
  });

  it('finds a pending voice message by id', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(1, 'alice'));
    const pendingId = await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: '[voice:pending]',
      userId: 1,
      sourceType: 'voice',
      processingStatus: 'pending',
    });
    const readyId = await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: 'ready',
      userId: 1,
    });

    const found = await messageRepo.findPendingVoiceById(pendingId);
    expect(found).toEqual(expect.objectContaining({ id: pendingId, processingStatus: 'pending' }));

    expect(await messageRepo.findPendingVoiceById(readyId)).toBeNull();
  });

  it('marks a pending voice message as failed', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(1, 'alice'));
    const id = await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: '[voice:pending]',
      userId: 1,
      sourceType: 'voice',
      processingStatus: 'pending',
    });

    await messageRepo.markVoiceFailed(id);

    // Should not appear in history (failed is not ready)
    expect(await messageRepo.findByChatId(1)).toEqual([]);
    // Direct pending lookup returns null (now failed)
    expect(await messageRepo.findPendingVoiceById(id)).toBeNull();
  });

  it('returns null from markVoiceTranscribed when message is not pending', async () => {
    await chatRepo.upsert(new ChatEntity(1));
    await userRepo.upsert(new UserEntity(1, 'alice'));
    const id = await messageRepo.insert({
      chatId: 1,
      role: 'user',
      content: '[voice:pending]',
      userId: 1,
      sourceType: 'voice',
      processingStatus: 'pending',
    });

    // First transcription succeeds
    await messageRepo.markVoiceTranscribed(id, '[voice] hello');
    // Second call on already-transcribed row returns null
    const result = await messageRepo.markVoiceTranscribed(id, '[voice] retry');
    expect(result).toBeNull();
  });

  it('stores, retrieves and expires access keys', async () => {
    const now = Date.now();
    const expiresAt = now + 1000;
    await accessKeyRepo.upsertKey({
      chatId: 1,
      userId: 2,
      accessKey: 'key',
      expiresAt,
    });
    let entry = await accessKeyRepo.findByChatAndUser(1, 2);
    expect(entry).toEqual({
      chatId: 1,
      userId: 2,
      accessKey: 'key',
      expiresAt,
    });
    await accessKeyRepo.deleteExpired(now);
    entry = await accessKeyRepo.findByChatAndUser(1, 2);
    expect(entry).toBeTruthy();
    await accessKeyRepo.deleteExpired(expiresAt + 1);
    expect(await accessKeyRepo.findByChatAndUser(1, 2)).toBeUndefined();
  });
});
