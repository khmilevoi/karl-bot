import { describe, expect, it } from 'vitest';

import { FACT_CHECK_CONFIG_ID } from '../src/application/fact-checking/FactCheckConfig';
import { FACT_CHECK_REASONING_SERVICE_ID } from '../src/application/fact-checking/FactCheckReasoningService';
import { SOURCE_SEARCH_SERVICE_ID } from '../src/application/fact-checking/SourceSearchService';
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
});
