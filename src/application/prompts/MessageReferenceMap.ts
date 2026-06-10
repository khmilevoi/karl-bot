/**
 * Per-AI-call mapping between the bot's real message store id (messages.id) and a
 * compact 1-based ordinal reference (#1..#N) shown to the model. The model never
 * sees real store ids; it emits ordinals, which are translated back here.
 */
export class MessageReferenceMap {
  private readonly storeIdToOrdinal: Map<number, number>;
  private readonly ordinalToStoreId: Map<number, number>;

  private constructor(orderedStoreIds: readonly number[]) {
    this.storeIdToOrdinal = new Map();
    this.ordinalToStoreId = new Map();
    orderedStoreIds.forEach((storeId, index) => {
      const ordinal = index + 1;
      this.storeIdToOrdinal.set(storeId, ordinal);
      this.ordinalToStoreId.set(ordinal, storeId);
    });
  }

  static fromMessages(
    messages: ReadonlyArray<{ id: number }>
  ): MessageReferenceMap {
    const orderedStoreIds = [...new Set(messages.map((m) => m.id))].sort(
      (a, b) => a - b
    );
    return new MessageReferenceMap(orderedStoreIds);
  }

  ordinalFor(storeId: number): number | null {
    return this.storeIdToOrdinal.get(storeId) ?? null;
  }

  storeIdFor(ordinal: number): number | null {
    return this.ordinalToStoreId.get(ordinal) ?? null;
  }

  /** Map a list of model-emitted ordinals to real store ids, dropping unresolved ones. */
  translate(ordinals: readonly number[]): number[] {
    const result: number[] = [];
    for (const ordinal of ordinals) {
      const storeId = this.storeIdFor(ordinal);
      if (storeId !== null) {
        result.push(storeId);
      }
    }
    return result;
  }
}
