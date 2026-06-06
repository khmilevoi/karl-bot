import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SQLiteDbProviderImpl } from '../src/infrastructure/persistence/sqlite/DbProvider';
import { SQLiteFactCheckRepository } from '../src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository';
import { TestEnvService } from '../src/infrastructure/config/TestEnvService';
import type { LoggerFactory } from '../src/application/interfaces/logging/LoggerFactory';
import type { InsertFactCheckFindingInput } from '../src/domain/repositories/FactCheckRepository';

const createLoggerFactory = (): LoggerFactory =>
  ({
    create: () => ({
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    }),
  }) as unknown as LoggerFactory;

describe('SQLiteFactCheckRepository', () => {
  let repo: SQLiteFactCheckRepository;

  beforeEach(async () => {
    vi.resetModules();
    const dir = mkdtempSync(path.join(tmpdir(), 'fact-repo-'));
    const dbFile = path.join(dir, 'test.db');
    process.env.DATABASE_URL = `file://${dbFile}`;

    const { migrateUp } = await import('../src/migrate');
    await migrateUp();

    const env = new TestEnvService();
    const provider = new SQLiteDbProviderImpl(env, createLoggerFactory());
    repo = new SQLiteFactCheckRepository(provider);
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  const now = () => new Date().toISOString();

  it('creates a run and returns its id', async () => {
    const id = await repo.createRun({
      chatId: 1,
      runType: 'hourly',
      startedAt: now(),
      messageFromId: null,
      messageToId: null,
      extractorModel: null,
      verifierModel: null,
    });
    expect(id).toBeGreaterThan(0);
  });

  it('completes a run', async () => {
    const id = await repo.createRun({
      chatId: 1,
      runType: 'hourly',
      startedAt: now(),
      messageFromId: null,
      messageToId: null,
      extractorModel: null,
      verifierModel: null,
    });
    await expect(
      repo.completeRun({
        runId: id,
        finishedAt: now(),
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        latencyMs: 1000,
        requestJson: {},
        responseJson: {},
      })
    ).resolves.toBeUndefined();
  });

  it('fails a run', async () => {
    const id = await repo.createRun({
      chatId: 1,
      runType: 'hourly',
      startedAt: now(),
      messageFromId: null,
      messageToId: null,
      extractorModel: null,
      verifierModel: null,
    });
    await expect(
      repo.failRun({ runId: id, finishedAt: now(), errorMessage: 'oops' })
    ).resolves.toBeUndefined();
  });

  const makeFinding = (
    runId: number,
    messageId: number,
    claimKey: string
  ): InsertFactCheckFindingInput => ({
    runId,
    chatId: 1,
    messageId,
    telegramMessageId: null,
    authorUserId: null,
    authorDisplayName: 'User',
    normalizedClaimKey: claimKey,
    claimText: 'The euro was introduced in 2000.',
    originalQuote: 'euro 2000',
    correctedFact: 'Euros in circulation since 2002.',
    explanation: 'Accounting vs cash.',
    category: 'external_fact',
    severity: 'low',
    status: 'confirmed',
    confidence: 0.9,
    sourcePolicy: 'reliable_or_media_allowed',
    sourceRequirementsMet: true,
    messageUrl: null,
    createdAt: now(),
    checkedAt: now(),
    sources: [
      {
        url: 'https://example.com',
        title: 'Example',
        publisher: null,
        snippet: 'euro snippet',
        reliability: 'authoritative',
        retrievedAt: now(),
      },
    ],
  });

  it('inserts finding with sources', async () => {
    const runId = await repo.createRun({
      chatId: 1,
      runType: 'hourly',
      startedAt: now(),
      messageFromId: null,
      messageToId: null,
      extractorModel: null,
      verifierModel: null,
    });
    const findingId = await repo.insertFinding(makeFinding(runId, 1, 'key1'));
    expect(findingId).not.toBeNull();
    expect(findingId).toBeGreaterThan(0);
  });

  it('does not insert duplicate (messageId + normalizedClaimKey)', async () => {
    const runId = await repo.createRun({
      chatId: 1,
      runType: 'hourly',
      startedAt: now(),
      messageFromId: null,
      messageToId: null,
      extractorModel: null,
      verifierModel: null,
    });
    const id1 = await repo.insertFinding(makeFinding(runId, 1, 'key1'));
    const id2 = await repo.insertFinding(makeFinding(runId, 1, 'key1'));
    expect(id1).not.toBeNull();
    expect(id2).toBeNull();
  });

  it('findUnsentDigest excludes already notified rows', async () => {
    const runId = await repo.createRun({
      chatId: 1,
      runType: 'hourly',
      startedAt: now(),
      messageFromId: null,
      messageToId: null,
      extractorModel: null,
      verifierModel: null,
    });
    const id1 = await repo.insertFinding(makeFinding(runId, 1, 'key1'));
    await repo.insertFinding(makeFinding(runId, 2, 'key2'));
    if (id1) await repo.markDigestNotified([id1], now());
    const unsent = await repo.findUnsentDigest(1, 10);
    expect(unsent.map((f) => f.normalizedClaimKey)).toEqual(['key2']);
  });

  it('getStats counts confirmed and uncertain separately', async () => {
    const runId = await repo.createRun({
      chatId: 1,
      runType: 'hourly',
      startedAt: now(),
      messageFromId: null,
      messageToId: null,
      extractorModel: null,
      verifierModel: null,
    });
    await repo.insertFinding(makeFinding(runId, 1, 'key1'));
    const uncertainFinding: InsertFactCheckFindingInput = {
      ...makeFinding(runId, 2, 'key2'),
      status: 'uncertain',
    };
    await repo.insertFinding(uncertainFinding);

    const rows = await repo.getStats({
      chatId: 1,
      fromIso: new Date(0).toISOString(),
      toIso: new Date(Date.now() + 100000).toISOString(),
    });
    const confirmed = rows.find((r) => r.status === 'confirmed');
    const uncertain = rows.find((r) => r.status === 'uncertain');
    expect(confirmed?.count).toBe(1);
    expect(uncertain?.count).toBe(1);
  });
});
