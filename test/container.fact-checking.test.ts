import { describe, expect, it } from 'vitest';

import { FACT_CHECK_CONFIG_ID } from '../src/application/fact-checking/FactCheckConfig';
import { FACT_CHECK_REASONING_SERVICE_ID } from '../src/application/fact-checking/FactCheckReasoningService';
import { SOURCE_SEARCH_SERVICE_ID } from '../src/application/fact-checking/SourceSearchService';
import { FACT_CHECK_STATS_SERVICE_ID } from '../src/application/fact-checking/FactCheckStatsService';
import { FACT_CHECK_NOTIFIER_ID } from '../src/application/fact-checking/FactCheckNotifier';
import { FACT_CHECK_PIPELINE_ID } from '../src/application/fact-checking/FactCheckPipeline';
import { FACT_CHECK_SCHEDULER_ID } from '../src/application/fact-checking/FactCheckScheduler';
import { container } from '../src/container';

describe('fact-checking DI', () => {
  it('resolves FactCheckConfig', () => {
    expect(container.get(FACT_CHECK_CONFIG_ID)).toBeTruthy();
  });

  it('resolves FactCheckReasoningService', () => {
    expect(container.get(FACT_CHECK_REASONING_SERVICE_ID)).toBeTruthy();
  });

  it('resolves SourceSearchService', () => {
    expect(container.get(SOURCE_SEARCH_SERVICE_ID)).toBeTruthy();
  });

  it('resolves FactCheckStatsService', () => {
    expect(container.get(FACT_CHECK_STATS_SERVICE_ID)).toBeTruthy();
  });

  it('resolves FactCheckNotifier', () => {
    expect(container.get(FACT_CHECK_NOTIFIER_ID)).toBeTruthy();
  });

  it('resolves FactCheckPipeline', () => {
    expect(container.get(FACT_CHECK_PIPELINE_ID)).toBeTruthy();
  });

  it('resolves FactCheckScheduler', () => {
    expect(container.get(FACT_CHECK_SCHEDULER_ID)).toBeTruthy();
  });
});
