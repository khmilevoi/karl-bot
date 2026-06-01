import { describe, expect, it } from 'vitest';

import { MessageReferenceMap } from '../src/application/prompts/MessageReferenceMap';

describe('MessageReferenceMap', () => {
  it('assigns 1-based ordinals in ascending storeId order', () => {
    const map = MessageReferenceMap.fromMessages([
      { id: 161 },
      { id: 150 },
      { id: 154 },
    ]);
    expect(map.ordinalFor(150)).toBe(1);
    expect(map.ordinalFor(154)).toBe(2);
    expect(map.ordinalFor(161)).toBe(3);
  });

  it('round-trips ordinal <-> storeId', () => {
    const map = MessageReferenceMap.fromMessages([{ id: 150 }, { id: 161 }]);
    expect(map.storeIdFor(1)).toBe(150);
    expect(map.storeIdFor(2)).toBe(161);
  });

  it('returns null for unknown storeId or out-of-range ordinal', () => {
    const map = MessageReferenceMap.fromMessages([{ id: 150 }]);
    expect(map.ordinalFor(999)).toBeNull();
    expect(map.storeIdFor(0)).toBeNull();
    expect(map.storeIdFor(2)).toBeNull();
  });

  it('translate() maps ordinals to storeIds and drops unresolved ones', () => {
    const map = MessageReferenceMap.fromMessages([{ id: 150 }, { id: 161 }]);
    expect(map.translate([1, 2, 99])).toEqual([150, 161]);
  });
});
