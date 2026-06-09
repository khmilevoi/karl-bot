# Fact Checker Logic Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix fact-checker logic defects around source policy, claim matching, notification routing, digest retry safety, and run audit data.

**Architecture:** Keep the current clean-architecture shape: pipeline orchestration stays in `src/application/fact-checking/DefaultFactCheckPipeline.ts`, source policy rules stay centralized in `FactCheckSourcePolicy.ts`, persistence changes stay behind repository interfaces, and Telegram formatting stays in `FactCheckFormatter.ts`. Add focused tests before each change and avoid broad refactors.

**Tech Stack:** TypeScript, Vitest, SQLite migrations, Inversify, OpenAI gateway abstractions.

---

## File Structure

- Modify: `src/application/fact-checking/DefaultFactCheckPipeline.ts`
  - Match verification findings to extracted claims safely.
  - Apply one centralized source-confirmation policy.
  - Persist `shouldNotifyImmediately`.
  - Store complete run audit data.
- Modify: `src/application/fact-checking/FactCheckSourcePolicy.ts`
  - Make source policy the single source of truth for whether a finding may remain `confirmed`.
- Modify: `src/domain/fact-checking/FactCheckTypes.ts`
  - Add `shouldNotifyImmediately` to persisted finding type if needed.
- Modify: `src/domain/entities/FactCheckFindingEntity.ts`
  - Expose persisted notification intent.
- Modify: `src/domain/repositories/FactCheckRepository.ts`
  - Add `shouldNotifyImmediately` to insert/read contracts.
  - Add model fields to run completion contract.
- Modify: `src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository.ts`
  - Read/write new notification-intent column.
  - Filter immediate/digest queues correctly.
  - Store model ids on run completion.
- Create: `migrations/023_fact_check_notification_intent.up.sql`
  - Add `should_notify_immediately INTEGER NOT NULL DEFAULT 0`.
- Create: `migrations/023_fact_check_notification_intent.down.sql`
  - Rebuild `fact_check_findings` without the added column, following existing SQLite migration style if needed.
- Modify: `src/application/fact-checking/FactCheckFormatter.ts`
  - Add chunk metadata for digest sending without breaking existing formatter tests.
- Modify: `src/application/fact-checking/DefaultFactCheckNotifier.ts`
  - Mark only successfully sent digest findings.
- Modify tests:
  - `test/FactCheckSourcePolicy.test.ts`
  - `test/DefaultFactCheckPipeline.test.ts`
  - `test/SQLiteFactCheckRepository.test.ts`
  - `test/factCheckMigration022.test.ts` or create `test/factCheckMigration023.test.ts`
  - `test/DefaultFactCheckNotifier.test.ts`
  - `test/FactCheckFormatter.test.ts`
  - `test/factCheck.e2e.test.ts`

---

### Task 1: Centralize Source Policy and Prevent False Confirmations

**Files:**
- Modify: `src/application/fact-checking/FactCheckSourcePolicy.ts`
- Modify: `src/application/fact-checking/DefaultFactCheckPipeline.ts`
- Test: `test/FactCheckSourcePolicy.test.ts`
- Test: `test/DefaultFactCheckPipeline.test.ts`

- [ ] **Step 1: Write failing policy tests**

Add tests covering:

```ts
it('rejects external_fact with only weak sources', () => {
  expect(
    canConfirmFinding({
      category: 'external_fact',
      sourcePolicy: 'reliable_or_media_allowed',
      sourceRequirementsMet: true,
      sources: [{ reliability: 'weak' }],
    })
  ).toBe(false);
});

it('rejects external_fact when verifier says source requirements are not met', () => {
  expect(
    canConfirmFinding({
      category: 'external_fact',
      sourcePolicy: 'reliable_or_media_allowed',
      sourceRequirementsMet: false,
      sources: [{ reliability: 'media' }],
    })
  ).toBe(false);
});

it('confirms high-stakes claims with authoritative professional sources', () => {
  expect(
    canConfirmFinding({
      category: 'medical',
      sourcePolicy: 'primary_required',
      sourceRequirementsMet: true,
      sources: [{ reliability: 'authoritative' }],
    })
  ).toBe(true);
});
```

Add a pipeline test where verifier returns `confirmed`, `sourceRequirementsMet: false`, and no valid sources. Expected insert status: `uncertain`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/FactCheckSourcePolicy.test.ts test/DefaultFactCheckPipeline.test.ts
```

Expected: new tests fail because pipeline does not use `finding.sourceRequirementsMet` and `reliable_or_media_allowed` accepts any source length.

- [ ] **Step 3: Implement source policy**

In `FactCheckSourcePolicy.ts`, make `canConfirmFinding` the only confirmation gate:

```ts
export function canConfirmFinding(input: SourcePolicyInput): boolean {
  if (!input.sourceRequirementsMet) return false;

  switch (input.sourcePolicy) {
    case 'chat_history_only':
      return input.category === 'chat_history';
    case 'primary_required':
      return input.sources.some((s) =>
        ['primary', 'authoritative'].includes(s.reliability)
      );
    case 'reliable_or_media_allowed':
      return input.sources.some((s) =>
        ['primary', 'authoritative', 'media'].includes(s.reliability)
      );
  }
}
```

In `DefaultFactCheckPipeline.ts`, replace local `checkSourceRequirements` confirmation logic with:

```ts
const localSourceRequirementsMet = this.checkSourceRequirements(
  sourcePolicy,
  findingSources
);
const sourceRequirementsMet =
  finding.sourceRequirementsMet && localSourceRequirementsMet;

let status = finding.status;
if (
  status === 'confirmed' &&
  !canConfirmFinding({
    category,
    sourcePolicy,
    sourceRequirementsMet,
    sources: findingSources,
  })
) {
  status = 'uncertain';
}
```

Update `checkSourceRequirements` so `reliable_or_media_allowed` rejects weak-only source lists.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/FactCheckSourcePolicy.test.ts test/DefaultFactCheckPipeline.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/application/fact-checking/FactCheckSourcePolicy.ts src/application/fact-checking/DefaultFactCheckPipeline.ts test/FactCheckSourcePolicy.test.ts test/DefaultFactCheckPipeline.test.ts
git commit -m "fix: enforce fact-check source policy"
```

---

### Task 2: Match Findings to the Correct Extracted Claim

**Files:**
- Modify: `src/application/fact-checking/DefaultFactCheckPipeline.ts`
- Test: `test/DefaultFactCheckPipeline.test.ts`

- [ ] **Step 1: Write failing multi-claim test**

Add a test with two extracted claims from the same message:

```ts
claims: [
  {
    messageId: 10,
    claimText: 'The sky is green',
    category: 'external_fact',
    riskLevel: 'low',
    needsExternalSources: true,
    whyCheckable: 'color claim',
    contextMessageIds: [],
  },
  {
    messageId: 10,
    claimText: 'This pill cures cancer',
    category: 'medical',
    riskLevel: 'high',
    needsExternalSources: true,
    whyCheckable: 'medical treatment claim',
    contextMessageIds: [],
  },
]
```

Verifier returns a finding for `This pill cures cancer`.

Expected insert:

```ts
expect(findingRepo.insertFinding).toHaveBeenCalledWith(
  expect.objectContaining({
    category: 'medical',
    severity: 'high',
    sourcePolicy: 'primary_required',
  })
);
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/DefaultFactCheckPipeline.test.ts
```

Expected: FAIL because current code matches category/severity by `messageId` only.

- [ ] **Step 3: Implement safe claim matching**

Add a private helper to `DefaultFactCheckPipeline.ts`:

```ts
private findClaimForFinding(
  finding: VerificationFinding,
  claims: ExtractedClaim[]
): ExtractedClaim | null {
  const sameMessage = claims.filter((c) => c.messageId === finding.messageId);
  if (sameMessage.length === 0) return null;

  const findingKey = normalizeClaimKey(finding.claimText);
  const exact = sameMessage.find(
    (c) => normalizeClaimKey(c.claimText) === findingKey
  );
  if (exact != null) return exact;

  return sameMessage.length === 1 ? sameMessage[0] : null;
}
```

Use the helper in the persistence loop. If no claim matches, log a warning and skip the finding instead of falling back to `external_fact`.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/DefaultFactCheckPipeline.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/application/fact-checking/DefaultFactCheckPipeline.ts test/DefaultFactCheckPipeline.test.ts
git commit -m "fix: match fact-check findings to exact claims"
```

---

### Task 3: Persist and Honor Immediate Notification Intent

**Files:**
- Create: `migrations/023_fact_check_notification_intent.up.sql`
- Create: `migrations/023_fact_check_notification_intent.down.sql`
- Modify: `src/domain/entities/FactCheckFindingEntity.ts`
- Modify: `src/domain/repositories/FactCheckRepository.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository.ts`
- Modify: `src/application/fact-checking/DefaultFactCheckPipeline.ts`
- Test: `test/factCheckMigration023.test.ts`
- Test: `test/SQLiteFactCheckRepository.test.ts`
- Test: `test/DefaultFactCheckPipeline.test.ts`

- [ ] **Step 1: Write failing migration/repository tests**

Create `test/factCheckMigration023.test.ts` verifying:

```ts
const info = await db.all("PRAGMA table_info(fact_check_findings)");
expect(info.map((c) => c.name)).toContain('should_notify_immediately');
```

Update repository tests:

```ts
it('findUnsentImmediate returns only immediate findings', async () => {
  // insert one finding with shouldNotifyImmediately true
  // insert one finding with shouldNotifyImmediately false
  // expect findUnsentImmediate to return only the true one
});

it('findUnsentDigest returns only non-immediate findings', async () => {
  // prevents duplicate immediate + digest delivery
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/factCheckMigration023.test.ts test/SQLiteFactCheckRepository.test.ts test/DefaultFactCheckPipeline.test.ts
```

Expected: FAIL because column/contracts do not exist.

- [ ] **Step 3: Add migration**

`migrations/023_fact_check_notification_intent.up.sql`:

```sql
BEGIN TRANSACTION;

ALTER TABLE fact_check_findings
  ADD COLUMN should_notify_immediately INTEGER NOT NULL DEFAULT 0;

COMMIT;
```

For down migration, use the repository's established SQLite table-rebuild pattern if existing migrations use one. If no existing pattern is available, document that SQLite cannot drop the column safely in-place and rebuild the table with all columns except `should_notify_immediately`.

- [ ] **Step 4: Update contracts and persistence**

Add `shouldNotifyImmediately: boolean` to:

- `FactCheckFindingEntity`
- `InsertFactCheckFindingInput`
- `FindingRow`
- `rowToFinding`
- `insertFinding`

Update SQL insert column list and values.

Update queries:

```sql
-- immediate
WHERE chat_id = ?
  AND should_notify_immediately = 1
  AND immediate_notified_at IS NULL

-- digest
WHERE chat_id = ?
  AND should_notify_immediately = 0
  AND digest_notified_at IS NULL
```

Update pipeline insert input:

```ts
shouldNotifyImmediately: finding.shouldNotifyImmediately,
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/factCheckMigration023.test.ts test/SQLiteFactCheckRepository.test.ts test/DefaultFactCheckPipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add migrations/023_fact_check_notification_intent.up.sql migrations/023_fact_check_notification_intent.down.sql src/domain/entities/FactCheckFindingEntity.ts src/domain/repositories/FactCheckRepository.ts src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository.ts src/application/fact-checking/DefaultFactCheckPipeline.ts test/factCheckMigration023.test.ts test/SQLiteFactCheckRepository.test.ts test/DefaultFactCheckPipeline.test.ts
git commit -m "fix: honor fact-check immediate notification intent"
```

---

### Task 4: Mark Only Successfully Sent Digest Findings

**Files:**
- Modify: `src/application/fact-checking/FactCheckFormatter.ts`
- Modify: `src/application/fact-checking/DefaultFactCheckNotifier.ts`
- Test: `test/FactCheckFormatter.test.ts`
- Test: `test/DefaultFactCheckNotifier.test.ts`

- [ ] **Step 1: Write failing notifier test**

Add a test with enough findings to produce two chunks. Make the first send pass and the second send fail.

Expected:

```ts
expect(findingRepo.markDigestNotified).toHaveBeenCalledWith(
  [firstChunkFindingId],
  expect.any(String)
);
expect(findingRepo.markDigestNotified).not.toHaveBeenCalledWith(
  expect.arrayContaining([failedChunkFindingId]),
  expect.any(String)
);
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/DefaultFactCheckNotifier.test.ts
```

Expected: FAIL because current code marks every fetched finding after attempting chunks.

- [ ] **Step 3: Add formatter chunk metadata**

Add a new exported function:

```ts
export interface FactCheckDigestChunk {
  text: string;
  findingIds: number[];
}

export function formatHourlyDigestChunks(
  findings: readonly FactCheckFindingWithSources[],
  config: FactCheckConfig
): FactCheckDigestChunk[] {
  // same text behavior as formatHourlyDigest, but keep ids for each finding part
}
```

Keep existing API as a wrapper:

```ts
export function formatHourlyDigest(
  findings: readonly FactCheckFindingWithSources[],
  config: FactCheckConfig
): string[] {
  return formatHourlyDigestChunks(findings, config).map((c) => c.text);
}
```

- [ ] **Step 4: Update notifier**

In `sendHourlyDigest`, use `formatHourlyDigestChunks`. Track successful ids:

```ts
const sentIds: number[] = [];
for (const chunk of chunks) {
  try {
    await this.messenger.sendMessage(chatId, chunk.text, options);
    sentIds.push(...chunk.findingIds);
  } catch (err) {
    this.logger.warn({ err, findingIds: chunk.findingIds }, 'Digest chunk send failed');
  }
}

await this.findingRepo.markDigestNotified([...new Set(sentIds)], now);
```

Do not mark anything if `sentIds.length === 0`.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/FactCheckFormatter.test.ts test/DefaultFactCheckNotifier.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/application/fact-checking/FactCheckFormatter.ts src/application/fact-checking/DefaultFactCheckNotifier.ts test/FactCheckFormatter.test.ts test/DefaultFactCheckNotifier.test.ts
git commit -m "fix: preserve unsent fact-check digest findings"
```

---

### Task 5: Store Complete Run Audit Data

**Files:**
- Modify: `src/domain/repositories/FactCheckRepository.ts`
- Modify: `src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository.ts`
- Modify: `src/application/fact-checking/DefaultFactCheckPipeline.ts`
- Test: `test/SQLiteFactCheckRepository.test.ts`
- Test: `test/DefaultFactCheckPipeline.test.ts`

- [ ] **Step 1: Write failing audit tests**

Pipeline test expectation:

```ts
expect(runRepo.completeRun).toHaveBeenCalledWith(
  expect.objectContaining({
    extractorModel: 'extract-model',
    verifierModel: 'verify-model',
    promptTokens: 30,
    completionTokens: 15,
    totalTokens: 45,
    requestJson: {
      extraction: expect.anything(),
      verification: expect.anything(),
    },
    responseJson: {
      extraction: expect.anything(),
      verification: expect.anything(),
    },
  })
);
```

Repository test: complete a run with model ids and assert DB columns `extractor_model` and `verifier_model` are set.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/SQLiteFactCheckRepository.test.ts test/DefaultFactCheckPipeline.test.ts
```

Expected: FAIL because run completion cannot store model ids and pipeline only stores verification metadata.

- [ ] **Step 3: Extend repository contract**

Update `CompleteFactCheckRunInput`:

```ts
extractorModel: string | null;
verifierModel: string | null;
```

Update SQL:

```sql
UPDATE fact_check_runs
SET status=?,
    finished_at=?,
    extractor_model=?,
    verifier_model=?,
    prompt_tokens=?,
    completion_tokens=?,
    total_tokens=?,
    latency_ms=?,
    request_json=?,
    response_json=?
WHERE id=?
```

- [ ] **Step 4: Update pipeline audit composition**

Add a helper for null-safe usage totals:

```ts
private sumUsage(
  left: AiUsage,
  right: AiUsage
): AiUsage {
  return {
    promptTokens: this.sumNullable(left.promptTokens, right.promptTokens),
    completionTokens: this.sumNullable(left.completionTokens, right.completionTokens),
    totalTokens: this.sumNullable(left.totalTokens, right.totalTokens),
  };
}
```

Use:

```ts
const usageMeta = this.sumUsage(
  extractionResult.metadata.usage,
  verificationResult.metadata.usage
);
```

Store:

```ts
extractorModel: extractionResult.metadata.selectedModel,
verifierModel: verificationResult.metadata.selectedModel,
requestJson: {
  extraction: extractionResult.requestJson,
  verification: verificationResult.requestJson,
},
responseJson: {
  extraction: extractionResult.responseJson,
  verification: verificationResult.responseJson,
},
```

- [ ] **Step 5: Run focused tests**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/SQLiteFactCheckRepository.test.ts test/DefaultFactCheckPipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/repositories/FactCheckRepository.ts src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository.ts src/application/fact-checking/DefaultFactCheckPipeline.ts test/SQLiteFactCheckRepository.test.ts test/DefaultFactCheckPipeline.test.ts
git commit -m "fix: store complete fact-check run audit data"
```

---

### Task 6: Integration Verification

**Files:**
- Modify only if earlier task failures reveal missed contracts.
- Test: all fact-check tests.

- [ ] **Step 1: Run fact-check test suite**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run test/DefaultFactCheckPipeline.test.ts test/DefaultFactCheckNotifier.test.ts test/FactCheckSourcePolicy.test.ts test/DefaultFactCheckSourceSearchService.test.ts test/factCheck.e2e.test.ts test/SQLiteFactCheckRepository.test.ts test/FactCheckFormatter.test.ts test/FactCheckMessageWindowRepository.test.ts test/factCheckMigration023.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run type check**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.json
```

Expected: exit code 0.

- [ ] **Step 3: Run full test suite if time allows**

Run:

```powershell
& 'C:\nvm4w\nodejs\node.exe' .\node_modules\vitest\vitest.mjs run
```

Expected: all tests pass.

- [ ] **Step 4: Inspect git diff**

Run:

```powershell
git diff --stat
git diff --check
```

Expected: no whitespace errors; changes limited to fact-check code, migration, and tests.

- [ ] **Step 5: Final commit**

If previous tasks were not committed separately:

```powershell
git add src/application/fact-checking src/domain/fact-checking src/domain/entities/FactCheckFindingEntity.ts src/domain/repositories/FactCheckRepository.ts src/infrastructure/persistence/sqlite/SQLiteFactCheckRepository.ts migrations test
git commit -m "fix: correct fact-checker logic"
```

---

## Notes and Non-Goals

- Do not edit `migrations/022_fact_checking.up.sql`; add migration 023 because 022 may already be applied in existing environments.
- Do not broaden source-search behavior unless tests prove it is required. This plan fixes confirmation policy, not search quality.
- Keep `formatHourlyDigest` public behavior compatible by adding a chunk-metadata function instead of replacing the existing return type.
- Do not change Telegram message id semantics. Fact-check prompts use internal stored `m.id`; `telegramMessageId` is only for links.
