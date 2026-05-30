import { describe, expect, it } from 'vitest';

import { BEHAVIOR_PIPELINE_ID } from '../src/application/behavior/BehaviorPipeline';
import { container } from '../src/container';

describe('behavior DI', () => {
  it('resolves the behavior pipeline', () => {
    expect(container.get(BEHAVIOR_PIPELINE_ID)).toBeTruthy();
  });
});
