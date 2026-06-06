import { inject, injectable } from 'inversify';

import {
  CHAT_REPOSITORY_ID,
  type ChatRepository,
} from '@/domain/repositories/ChatRepository';
import type { ChatMessage } from '@/domain/messages/ChatMessage';
import {
  FACT_CHECK_MESSAGE_WINDOW_REPOSITORY_ID,
  type FactCheckMessageWindowRepository,
} from '@/domain/repositories/FactCheckMessageWindowRepository';
import {
  FACT_CHECK_WINDOW_REPOSITORY_ID,
  type FactCheckWindowRepository,
} from '@/domain/repositories/FactCheckWindowRepository';
import {
  FACT_CHECK_RUN_REPOSITORY_ID,
  FACT_CHECK_FINDING_REPOSITORY_ID,
  type FactCheckRunRepository,
  type FactCheckFindingRepository,
  type InsertFactCheckFindingInput,
  type InsertFactCheckSourceInput,
} from '@/domain/repositories/FactCheckRepository';
import type { Logger } from '@/application/interfaces/logging/Logger';
import {
  LOGGER_FACTORY_ID,
  type LoggerFactory,
} from '@/application/interfaces/logging/LoggerFactory';
import { FACT_CHECK_CONFIG_ID, type FactCheckConfig } from './FactCheckConfig';
import {
  FACT_CHECK_REASONING_SERVICE_ID,
  type FactCheckReasoningService,
} from './FactCheckReasoningService';
import {
  SOURCE_SEARCH_SERVICE_ID,
  type SourceSearchService,
  type SourceSearchResult,
} from './SourceSearchService';
import {
  FACT_CHECK_NOTIFIER_ID,
  type FactCheckNotifier,
} from './FactCheckNotifier';
import type {
  FactCheckPipeline,
  FactCheckRunOutcome,
  FactCheckRunResult,
} from './FactCheckPipeline';
import { normalizeClaimKey } from './FactCheckDeduplication';
import { getSourcePolicyForCategory } from './FactCheckSourcePolicy';
import { buildTelegramMessageUrl } from './FactCheckMessageLinks';
import type { ExtractedClaim } from '@/domain/fact-checking/FactCheckTypes';
import type { FactCheckVerificationPromptContext } from './FactCheckPromptContext';

@injectable()
export class DefaultFactCheckPipeline implements FactCheckPipeline {
  private readonly logger: Logger;

  constructor(
    @inject(FACT_CHECK_CONFIG_ID) private readonly config: FactCheckConfig,
    @inject(FACT_CHECK_MESSAGE_WINDOW_REPOSITORY_ID)
    private readonly windowRepo: FactCheckMessageWindowRepository,
    @inject(FACT_CHECK_WINDOW_REPOSITORY_ID)
    private readonly cursorRepo: FactCheckWindowRepository,
    @inject(CHAT_REPOSITORY_ID) private readonly chatRepo: ChatRepository,
    @inject(FACT_CHECK_REASONING_SERVICE_ID)
    private readonly reasoning: FactCheckReasoningService,
    @inject(SOURCE_SEARCH_SERVICE_ID)
    private readonly sourceSearch: SourceSearchService,
    @inject(FACT_CHECK_RUN_REPOSITORY_ID)
    private readonly runRepo: FactCheckRunRepository,
    @inject(FACT_CHECK_FINDING_REPOSITORY_ID)
    private readonly findingRepo: FactCheckFindingRepository,
    @inject(FACT_CHECK_NOTIFIER_ID)
    private readonly notifier: FactCheckNotifier,
    @inject(LOGGER_FACTORY_ID) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create('DefaultFactCheckPipeline');
  }

  async runHourly(chatId: number): Promise<FactCheckRunResult> {
    if (!this.config.enabled) {
      return this.skip(chatId, 'skipped_disabled');
    }

    const cursor = await this.cursorRepo.get(chatId);
    const lastCheckedMessageId = cursor?.lastCheckedMessageId ?? 0;

    const batchMessages = await this.windowRepo.findReadyByChatIdAfterId(
      chatId,
      lastCheckedMessageId,
      this.config.maxMessagesPerBatch
    );

    if (batchMessages.length === 0) {
      return this.skip(chatId, 'skipped_no_messages');
    }

    const firstBatchId = batchMessages[0].id ?? 0;
    const lastBatchId = batchMessages[batchMessages.length - 1].id ?? 0;

    const contextMessages = await this.windowRepo.findReadyContextBeforeId(
      chatId,
      firstBatchId,
      this.config.maxHistoryContextMessages
    );

    const chat = await this.chatRepo.findById(chatId);
    const chatUsername = chat?.username ?? null;

    const now = new Date().toISOString();
    const runId = await this.runRepo.createRun({
      chatId,
      runType: 'hourly',
      startedAt: now,
      messageFromId: firstBatchId,
      messageToId: lastBatchId,
      extractorModel: null,
      verifierModel: null,
    });

    try {
      const start = Date.now();

      const extractionResult = await this.reasoning.extractClaims({
        batchMessages,
        contextMessages,
      });

      const claims = extractionResult.result.claims.slice(
        0,
        this.config.maxClaimsPerBatch
      );

      const batchById = new Map<number, ChatMessage>(
        batchMessages
          .filter((m): m is ChatMessage & { id: number } => m.id != null)
          .map((m) => [m.id as number, m])
      );

      const sources = await this.fetchSources(claims);

      const verifyInput: FactCheckVerificationPromptContext = {
        candidates: claims,
        batchMessages,
        contextMessages,
        sources,
      };

      const verificationResult = await this.reasoning.verifyClaims(verifyInput);
      const latencyMs = Date.now() - start;

      const usageMeta = verificationResult.metadata.usage;

      let persistedFindings = 0;
      for (const finding of verificationResult.result.findings) {
        if (finding.status === 'no_error') continue;

        const message = batchById.get(finding.messageId);
        if (message == null) continue;

        const category =
          claims.find((c) => c.messageId === finding.messageId)?.category ??
          'external_fact';
        const severity =
          claims.find((c) => c.messageId === finding.messageId)?.riskLevel ??
          'low';

        const sourcePolicy = getSourcePolicyForCategory(category);
        const findingSources = finding.sourceIndexes
          .filter((i) => i >= 0 && i < sources.length)
          .map((i) => sources[i]);

        const sourceRequirementsMet = this.checkSourceRequirements(
          sourcePolicy,
          findingSources
        );
        let status = finding.status;
        if (
          sourcePolicy === 'primary_required' &&
          !sourceRequirementsMet &&
          status === 'confirmed'
        ) {
          status = 'uncertain';
        }

        const telegramMessageId = message.messageId ?? null;
        const messageUrl = buildTelegramMessageUrl({
          chatId,
          chatUsername,
          telegramMessageId,
        });

        const input: InsertFactCheckFindingInput = {
          runId,
          chatId,
          messageId: finding.messageId,
          telegramMessageId,
          authorUserId: message.userId ?? null,
          authorDisplayName: this.buildDisplayName(message),
          normalizedClaimKey: normalizeClaimKey(finding.claimText),
          claimText: finding.claimText,
          originalQuote: message.content.slice(0, 500),
          correctedFact: finding.correctedFact,
          explanation: finding.explanation,
          category,
          severity,
          status,
          confidence: finding.confidence,
          sourcePolicy,
          sourceRequirementsMet,
          messageUrl,
          createdAt: now,
          checkedAt: now,
          sources: findingSources.map(
            (s): InsertFactCheckSourceInput => ({
              url: s.url,
              title: s.title,
              publisher: s.publisher,
              snippet: s.snippet,
              reliability: s.reliability,
              retrievedAt: s.retrievedAt,
            })
          ),
        };

        const insertedId = await this.findingRepo.insertFinding(input);
        if (insertedId != null) persistedFindings++;
      }

      await this.runRepo.completeRun({
        runId,
        finishedAt: new Date().toISOString(),
        promptTokens: usageMeta.promptTokens,
        completionTokens: usageMeta.completionTokens,
        totalTokens: usageMeta.totalTokens,
        latencyMs,
        requestJson: verificationResult.requestJson,
        responseJson: verificationResult.responseJson,
      });

      await this.cursorRepo.upsert({
        chatId,
        lastCheckedMessageId: lastBatchId,
        lastCheckedAt: now,
        updatedAt: new Date().toISOString(),
      });

      void this.notifier.sendImmediate(chatId).catch((err: unknown) => {
        this.logger.warn({ err }, 'Immediate notification failed');
      });
      void this.notifier.sendHourlyDigest(chatId).catch((err: unknown) => {
        this.logger.warn({ err }, 'Digest notification failed');
      });

      return {
        chatId,
        outcome: 'completed',
        runId,
        processedMessages: batchMessages.length,
        persistedFindings,
      };
    } catch (err) {
      this.logger.error({ err }, 'FactCheck pipeline failed for chat');
      await this.runRepo
        .failRun({
          runId,
          finishedAt: new Date().toISOString(),
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        .catch(() => undefined);
      return {
        chatId,
        outcome: 'failed',
        runId,
        processedMessages: 0,
        persistedFindings: 0,
      };
    }
  }

  async runStats(
    chatId: number,
    _period: 'daily' | 'weekly' | 'monthly'
  ): Promise<FactCheckRunResult> {
    void this.notifier.sendStats(chatId, _period).catch((err: unknown) => {
      this.logger.warn({ err }, 'Stats notification failed');
    });
    return {
      chatId,
      outcome: 'completed',
      runId: null,
      processedMessages: 0,
      persistedFindings: 0,
    };
  }

  private async fetchSources(
    claims: ExtractedClaim[]
  ): Promise<SourceSearchResult[]> {
    const needingSearch = claims.filter((c) => c.needsExternalSources);
    const capped = needingSearch.slice(
      0,
      this.config.maxSourceSearchesPerBatch
    );
    const allSources: SourceSearchResult[] = [];

    for (const claim of capped) {
      try {
        const results = await this.sourceSearch.search({
          claimText: claim.claimText,
          category: claim.category,
          maxSources: this.config.maxSourcesPerFinding,
        });
        allSources.push(...results);
      } catch (err) {
        this.logger.warn({ err }, 'Source search failed for claim, continuing');
      }
    }

    return allSources;
  }

  private checkSourceRequirements(
    sourcePolicy: string,
    sources: SourceSearchResult[]
  ): boolean {
    switch (sourcePolicy) {
      case 'primary_required':
        return sources.some(
          (s) =>
            s.reliability === 'primary' || s.reliability === 'authoritative'
        );
      case 'reliable_or_media_allowed':
        return sources.length > 0;
      case 'chat_history_only':
        return true;
      default:
        return true;
    }
  }

  private buildDisplayName(message: ChatMessage): string {
    if (message.fullName) return message.fullName;
    const parts = [message.firstName, message.lastName].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
    if (message.username) return `@${message.username}`;
    return `user_${message.userId ?? 'unknown'}`;
  }

  private skip(
    chatId: number,
    outcome: FactCheckRunOutcome
  ): FactCheckRunResult {
    return {
      chatId,
      outcome,
      runId: null,
      processedMessages: 0,
      persistedFindings: 0,
    };
  }
}
