/**
 * End-to-end integration test for the fact-check pipeline.
 * Uses a real SQLite database but mocks the AI reasoning service,
 * source search service, notifier, and chat repository.
 */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteFactCheckMessageWindowRepository } from '../src/infrastructure/persistence/sqlite/SQLiteFactCheckMessageWindowRepository';
import { SQLiteFactCheckWindowRepository } from '../src/infrastructure/persistence/sqlite/SQLiteFactCheckWindowRepository';
import { SQLiteFactCheckRepository } from '../src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository';
import { DefaultFactCheckPipeline } from '../src/application/fact-checking/DefaultFactCheckPipeline';
import type { FactCheckConfig } from '../src/application/fact-checking/FactCheckConfig';
import type { FactCheckReasoningService } from '../src/application/fact-checking/FactCheckReasoningService';
import type { SourceSearchService } from '../src/application/fact-checking/SourceSearchService';
import type { FactCheckNotifier } from '../src/application/fact-checking/FactCheckNotifier';
import type { ChatRepository } from '../src/domain/repositories/ChatRepository';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import type { Database } from 'sqlite';

function makeLoggerFactory(): LoggerFactory {
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return this;
    },
  };
  return { create: () => logger } as unknown as LoggerFactory;
}

function makeConfig(): FactCheckConfig {
  return {
    enabled: true,
    hourlyCron: '0 * * * *',
    dailyStatsCron: '0 9 * * *',
    weeklyStatsCron: '0 9 * * 1',
    monthlyStatsCron: '0 9 1 * *',
    timezone: 'UTC',
    maxMessagesPerBatch: 20,
    maxClaimsPerBatch: 5,
    maxHistoryContextMessages: 5,
    maxSourceSearchesPerBatch: 2,
    maxSourcesPerFinding: 3,
    maxDisplayedSourcesPerFinding: 2,
    maxFindingsPerDigestMessage: 5,
    verificationConfidenceThreshold: 0.75,
  };
}

async function insertMessage(
  db: Database,
  opts: {
    chatId: number;
    content: string;
    role?: string;
    messageId?: number;
    userId?: number;
  }
): Promise<number> {
  const result = await db.run(
    `INSERT INTO messages (chat_id, user_id, role, content, is_active, processing_status, message_id)
     VALUES (?, ?, ?, ?, 1, 'ready', ?)`,
    opts.chatId,
    opts.userId ?? 1,
    opts.role ?? 'user',
    opts.content,
    opts.messageId ?? Math.floor(Math.random() * 100000)
  );
  return result.lastID as number;
}

describe('FactCheck pipeline e2e', () => {
  let db: Database;
  let provider: SQLiteDbProviderImpl;
  let pipeline: DefaultFactCheckPipeline;
  let factCheckRepo: SQLiteFactCheckRepository;

  beforeEach(async () => {
    vi.resetModules();
    const dir = mkdtempSync(path.join(tmpdir(), 'fact-e2e-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const env = new TestEnvService();
    provider = new SQLiteDbProviderImpl(env, makeLoggerFactory());
    db = await provider.get();

    const windowRepo = new SQLiteFactCheckMessageWindowRepository(provider);
    const cursorRepo = new SQLiteFactCheckWindowRepository(provider);
    factCheckRepo = new SQLiteFactCheckRepository(provider);

    const chatRepo = {
      findById: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatRepository;

    const notifier = {
      sendImmediate: vi.fn().mockResolvedValue(undefined),
      sendHourlyDigest: vi.fn().mockResolvedValue(undefined),
      sendStats: vi.fn(),
    } as unknown as FactCheckNotifier;

    const sourceSearch = {
      search: vi.fn().mockResolvedValue([]),
    } as unknown as SourceSearchService;

    const reasoning = {
      extractClaims: vi.fn().mockResolvedValue({
        result: {
          claims: [],
        },
        metadata: {
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
      verifyClaims: vi.fn().mockResolvedValue({
        result: { findings: [] },
        metadata: {
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          escalated: false,
        },
        requestJson: {},
        responseJson: {},
      }),
    } as unknown as FactCheckReasoningService;

    pipeline = new DefaultFactCheckPipeline(
      makeConfig(),
      windowRepo,
      cursorRepo,
      chatRepo,
      reasoning,
      sourceSearch,
      factCheckRepo,
      factCheckRepo,
      notifier,
      makeLoggerFactory()
    );
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('returns skipped_no_messages when no messages exist', async () => {
    const result = await pipeline.runHourly(999);
    expect(result.outcome).toBe('skipped_no_messages');
  });

  it('completes run and creates a run record when messages exist', async () => {
    const chatId = 1;
    await insertMessage(db, { chatId, content: 'Hello world', messageId: 101 });
    await insertMessage(db, {
      chatId,
      content: 'Another message',
      messageId: 102,
    });

    const result = await pipeline.runHourly(chatId);

    expect(result.outcome).toBe('completed');
    expect(result.runId).toBeGreaterThan(0);
    expect(result.processedMessages).toBe(2);
    expect(result.persistedFindings).toBe(0);
  });

  it('advances the cursor after a successful run', async () => {
    const chatId = 2;
    const msgId = await insertMessage(db, {
      chatId,
      content: 'Test message',
      messageId: 201,
    });

    const first = await pipeline.runHourly(chatId);
    expect(first.outcome).toBe('completed');

    const cursor = await db.get(
      'SELECT last_checked_message_id FROM fact_check_windows WHERE chat_id = ?',
      chatId
    );
    expect(cursor?.last_checked_message_id).toBe(msgId);
  });

  it('persists a confirmed finding from AI output', async () => {
    const chatId = 3;
    const msgId = await insertMessage(db, {
      chatId,
      content: 'The sky is green',
      messageId: 301,
    });

    const extractClaims = vi.fn().mockResolvedValue({
      result: {
        claims: [
          {
            messageId: msgId,
            claimText: 'The sky is green',
            category: 'external_fact',
            needsExternalSources: false,
            riskLevel: 'low',
            whyCheckable: 'color of sky',
            contextMessageIds: [],
          },
        ],
      },
      metadata: {
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        escalated: false,
      },
      requestJson: {},
      responseJson: {},
    });

    const verifyClaims = vi.fn().mockResolvedValue({
      result: {
        findings: [
          {
            messageId: msgId,
            claimText: 'The sky is green',
            status: 'confirmed',
            confidence: 0.95,
            correctedFact: 'The sky is blue',
            explanation: 'Basic atmospheric optics',
            sourceRequirementsMet: true,
            sourceIndexes: [],
            shouldNotifyImmediately: false,
          },
        ],
      },
      metadata: {
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        escalated: false,
      },
      requestJson: {},
      responseJson: {},
    });

    // Rebuild pipeline with AI that returns a finding
    const windowRepo = new SQLiteFactCheckMessageWindowRepository(provider);
    const cursorRepo = new SQLiteFactCheckWindowRepository(provider);
    const pipelineWithFinding = new DefaultFactCheckPipeline(
      makeConfig(),
      windowRepo,
      cursorRepo,
      {
        findById: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatRepository,
      { extractClaims, verifyClaims } as unknown as FactCheckReasoningService,
      {
        search: vi.fn().mockResolvedValue([]),
      } as unknown as SourceSearchService,
      factCheckRepo,
      factCheckRepo,
      {
        sendImmediate: vi.fn().mockResolvedValue(undefined),
        sendHourlyDigest: vi.fn().mockResolvedValue(undefined),
        sendStats: vi.fn(),
      } as unknown as FactCheckNotifier,
      makeLoggerFactory()
    );

    const result = await pipelineWithFinding.runHourly(chatId);
    expect(result.outcome).toBe('completed');
    expect(result.persistedFindings).toBe(1);

    const finding = await db.get(
      'SELECT * FROM fact_check_findings WHERE chat_id = ? AND message_id = ?',
      chatId,
      msgId
    );
    expect(finding).toBeTruthy();
    expect(finding.status).toBe('confirmed');
    expect(finding.claim_text).toBe('The sky is green');
  });

  it('does not re-process messages below the watermark', async () => {
    const chatId = 4;
    await insertMessage(db, {
      chatId,
      content: 'First message',
      messageId: 401,
    });

    const first = await pipeline.runHourly(chatId);
    expect(first.outcome).toBe('completed');

    const second = await pipeline.runHourly(chatId);
    expect(second.outcome).toBe('skipped_no_messages');
  });
});
