# Carl Fact Checker Design

Date: 2026-06-05

## Summary

Add a conservative fact-checking feature to Carl. Carl should monitor approved
Telegram chats, batch new messages roughly once per hour, detect factual errors,
store full findings in SQLite, and publish compact Telegram-formatted fact-check
messages with source links.

The feature should be intentionally conservative. Public corrections should only
be sent as confirmed errors when the system has high confidence and sufficient
evidence. Ambiguous cases are still public in this MVP, but they must be labeled
as "requires checking" rather than treated as confirmed mistakes.

Chat-facing copy should match Carl's current Russian-language UX. English
message examples in this spec are structural templates, not final copy.

## Goals

- Detect factual errors in approved chats.
- Cover three categories of factual issues:
  - Objective external facts: dates, numbers, names, events, rules, "X did Y".
  - Chat-history contradictions: claims that conflict with prior messages or
    established chat context.
  - High-stakes claims: medical, legal, financial, and safety statements.
- Use a two-stage AI pipeline:
  - First stage extracts checkable claims and candidate issues.
  - Second stage verifies candidates with a stronger reasoning model.
- Use external sources only when needed for external facts.
- Require stricter sources for high-stakes topics.
- Store full findings indefinitely.
- Publish:
  - Immediate replies for confirmed high-stakes errors.
  - Hourly digests for ordinary confirmed errors and uncertain cases.
  - Daily, weekly, and monthly statistics.
- Count only confirmed errors in public rankings, while showing uncertain counts
  separately.
- Format Telegram output with Telegram-compatible HTML and clickable links.

## Non-Goals

- No dispute or appeal workflow in the MVP.
- No per-chat UI for schedule configuration in the MVP.
- No automatic deletion or retention trimming in the MVP.
- No public "lying" or blame language.
- No attempt to verify jokes, opinions, predictions, taste judgments,
  hyperbole, or vague interpretations unless there is a clear checkable claim.

## Product Behavior

The MVP operates in a conservative mode:

- Confirmed errors require high confidence and sufficient evidence.
- Uncertain cases are public, but visibly separated from confirmed errors.
- High-stakes confirmed errors are sent immediately as replies to the original
  Telegram message.
- Ordinary confirmed errors are included in the hourly digest.
- Statistics are posted to the chat daily, weekly, and monthly.
- Public rankings use confirmed errors only.
- Uncertain cases are displayed as a separate counter and section.
- Immediate high-stakes corrections should not be repeated as full entries in
  the hourly digest by default. The digest may include a compact count or
  reference if needed, while statistics still count them normally.

Public language should be neutral:

- Use "Fact check" and "requires checking".
- Avoid "you lied", "false", or accusatory phrasing.
- Prefer "This appears to contain a factual error" for confirmed cases.
- Prefer "This requires checking" for uncertain cases.

## Architecture

Add a separate `fact-checking` bounded context. Do not merge this into the
existing behavior pipeline, because personality/memory behavior and factual
auditing have different responsibilities, prompts, data, and failure modes.

Fact-checking depends on the separate OpenAI gateway refactor described in
`docs/superpowers/plans/2026-06-05-openai-gateway-refactor.md`. After that
prerequisite, business AI services do not construct `OpenAI` clients or call
the SDK directly; the fact-checking model service follows the same rule.

Core components:

- `OpenAiGateway`
  - Low-level wrapper around the OpenAI Node SDK.
  - Owns client construction, chat completion calls, parsed structured output,
    Responses web search calls, embeddings, and audio transcription as needed.
  - Returns provider metadata in a normalized shape.
  - Is the only production code allowed to import the OpenAI SDK value client.

- `FactCheckScheduler`
  - Runs hourly batch checks.
  - Runs daily, weekly, and monthly statistics jobs.
  - Uses MVP schedule constants or env values.
  - Leaves room for future `chat_configs` integration.
  - Applies batch and notification limits so a busy chat cannot create an
    unbounded AI/search/Telegram workload.

- `FactCheckWindowRepository`
  - Stores per-chat processing watermarks.
  - Prevents duplicate hourly analysis.
  - Updates the watermark only after a batch is successfully processed.

- `FactCheckReasoningService`
  - First AI stage.
  - Reads a batch of new messages plus limited prior context.
  - Extracts checkable claims and candidate issues.
  - Classifies claim category and risk.
  - Does not make public accusations.
  - Second AI stage.
  - Uses a stronger reasoning model.
  - Verifies candidates against chat history and, when needed, external sources.
  - Produces structured findings with status, confidence, correction,
    explanation, and notification decision.
  - Uses `OpenAiGateway`; it does not directly depend on the OpenAI SDK.

- `SourceSearchService`
  - Abstracts external search.
  - Returns normalized source candidates with URL, title, publisher, snippet,
    reliability level, and retrieved timestamp.
  - The MVP provider is OpenAI Responses web search through `OpenAiGateway`.
    Tests can use a fake provider.

- `FactCheckRepository`
  - Persists findings, sources, and run/audit metadata.
  - Deduplicates findings by message and normalized claim.

- `FactCheckNotifier`
  - Builds Telegram HTML output.
  - Sends immediate high-stakes replies.
  - Sends hourly digests.
  - Sends daily, weekly, and monthly reports.
  - Escapes all user and model text before sending HTML.

- `FactCheckStatsService`
  - Aggregates findings by chat, user, time range, category, status, and
    severity.
  - Keeps confirmed and uncertain counts separate.

## Data Flow

1. The existing Telegram message flow stores user messages through
   `MessageService`.
2. The hourly scheduler lists approved chats.
3. For each chat, it loads ready messages after the last fact-check watermark.
   Pending or failed voice messages are ignored until they become ready.
4. It loads a bounded amount of previous chat context for chat-history checks.
5. `FactCheckReasoningService` extracts checkable claims and candidates.
6. `FactCheckReasoningService` verifies candidates.
7. For external facts, verification calls `SourceSearchService` only when the
   claim needs independent or current evidence.
8. Findings and sources are saved through `FactCheckRepository`.
9. Immediate high-stakes confirmed findings are sent as replies.
10. The hourly digest is sent for confirmed ordinary errors and uncertain cases.
11. The processing watermark is advanced after successful batch persistence.
12. Statistics jobs aggregate saved findings and publish reports.

## Data Model

### `fact_check_windows`

Tracks incremental processing per chat.

- `chat_id`
- `last_checked_message_id`
- `last_checked_at`
- `updated_at`

### `fact_check_runs`

Stores batch-level audit/debug data.

- `id`
- `chat_id`
- `run_type`: `hourly | daily_stats | weekly_stats | monthly_stats | manual`
- `status`: `started | completed | failed | partial`
- `started_at`
- `finished_at`
- `message_from_id`
- `message_to_id`
- `extractor_model`
- `verifier_model`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `latency_ms`
- `error_message`
- `request_json`
- `response_json`

### `fact_check_findings`

Stores one factual finding.

- `id`
- `run_id`
- `chat_id`
- `message_id`
- `telegram_message_id`
- `author_user_id`
- `author_display_name`
- `claim_text`
- `original_quote`
- `corrected_fact`
- `explanation`
- `category`:
  - `external_fact`
  - `chat_history`
  - `medical`
  - `legal`
  - `financial`
  - `safety`
  - `mixed`
- `severity`: `low | medium | high`
- `status`: `confirmed | uncertain`
- `confidence`
- `source_policy`:
  - `chat_history_only`
  - `reliable_or_media_allowed`
  - `primary_required`
- `source_requirements_met`
- `message_url`
- `immediate_notified_at`
- `digest_notified_at`
- `notification_error`
- `created_at`
- `checked_at`

Deduplication should prevent duplicate findings for the same
`message_id + normalized_claim_text`.

### `fact_check_sources`

Stores sources used for a finding.

- `id`
- `finding_id`
- `url`
- `title`
- `publisher`
- `snippet`
- `reliability`: `primary | authoritative | media | weak`
- `retrieved_at`

Recommended indexes:

- `fact_check_windows(chat_id)`
- `fact_check_findings(chat_id, checked_at)`
- `fact_check_findings(author_user_id, checked_at)`
- `fact_check_findings(status, checked_at)`
- `fact_check_sources(finding_id)`
- A unique index for finding deduplication.

## AI Pipeline

### Stage 1: Claim Extraction

Input:

- New messages in the current batch.
- Limited previous context from the same chat.
- Message metadata: internal message id, Telegram message id, author, timestamp,
  reply/quote text when available.

Output as strict structured JSON:

- `message_id`
- `claim_text`
- `category`
- `needs_external_sources`
- `risk_level`
- `why_checkable`
- `context_message_ids`

Rules:

- Do not classify a claim as an error.
- Ignore jokes, opinions, predictions, hyperbole, preferences, and vague claims.
- Prefer fewer, stronger candidates over many weak candidates.
- Mark high-stakes categories even when the claim is only potentially wrong.

### Stage 2: Verification

Input:

- Extracted candidates.
- Relevant chat history.
- Sources from `SourceSearchService` when needed.

Output as strict structured JSON:

- `status`: `confirmed | uncertain | no_error`
- `confidence`
- `corrected_fact`
- `explanation`
- `source_requirements_met`
- `sources_used`
- `should_notify_immediately`

Persistence rules:

- Store `confirmed` and `uncertain`.
- `no_error` may be stored only in run audit metadata unless implementation
  planning finds a clear operational need for a table row.

## Source Policy

- `chat_history`
  - Uses chat messages only.
  - External sources are not required.

- Ordinary external facts
  - Can use primary sources, reliable references, and authoritative media.
  - Sources must support the correction, not merely mention the topic.

- High-stakes topics
  - Includes medical, legal, financial, and safety claims.
  - Requires primary or professional sources.
  - If sufficient high-quality sources are unavailable, the finding cannot be
    `confirmed`; it should be `uncertain` at most.

- Conflicting sources
  - If credible sources disagree, do not mark as `confirmed`.
  - Summarize the uncertainty compactly.

Telegram output should include 1-3 source links per finding. The database may
store more.

## Telegram Output

Use Telegram HTML formatting for predictable links and simple formatting.
All interpolated text must be escaped before sending.

### Immediate High-Stakes Reply

Template:

```html
<b>Fact check</b>: important factual issue

<blockquote>short original quote</blockquote>

<b>Correction:</b> short corrected fact.
<b>Why it matters:</b> one short sentence.
<b>Sources:</b> <a href="...">source 1</a>, <a href="...">source 2</a>
```

This should be sent with `reply_to_message_id` when possible.

### Hourly Digest

Template:

```html
<b>Fact check: last hour</b>

<b>Confirmed errors</b>
1. <a href="message_url">Message</a> · Author
   Was: short quote
   Correct: short correction
   Sources: <a href="...">1</a>, <a href="...">2</a>

<b>Requires checking</b>
1. <a href="message_url">Message</a> · Author
   Claim: claim text
   Why uncertain: short explanation
```

### Statistics

Template:

```html
<b>Fact check: day</b>

1. Author A - 3 confirmed, 1 requires checking
2. Author B - 1 confirmed, 4 require checking

Categories: external_fact 2, chat_history 1, financial 1
```

Message links:

- Public chat with username:
  - `https://t.me/<chat_username>/<telegram_message_id>`
- Supergroup internal link when computable:
  - `https://t.me/c/<internal_chat_id>/<telegram_message_id>`
  - For Telegram supergroup ids shaped like `-1001234567890`, the internal chat
    id segment is usually `1234567890`.
- Fallback:
  - Author, timestamp, short quote, and `reply_to_message_id` for immediate
    replies.

Digest length:

- Cap the number of findings per Telegram message.
- Split into multiple messages or add "and N more findings" when the digest is
  too large.

## Scheduling

MVP schedule:

- Hourly fact-check digest.
- Daily statistics.
- Weekly statistics.
- Monthly statistics.

Configuration:

- Use env values or code constants in the MVP.
- Design service boundaries so schedules can later move into `chat_configs`.
- Include a global feature flag so the fact checker can be disabled without
  removing code.
- Include conservative caps:
  - Maximum messages per batch.
  - Maximum claims per batch.
  - Maximum history context messages.
  - Maximum source searches per batch.
  - Maximum sources stored and displayed per finding.
  - Maximum findings per Telegram digest message.

## Error Handling

- If a claim cannot be verified reliably, it cannot become `confirmed`.
- If high-stakes sources are insufficient, status is at most `uncertain`.
- External search failure should not crash the whole batch.
- AI structured-output validation failure should be recorded in
  `fact_check_runs`.
- Batch persistence should happen before notification.
- The watermark should advance only after successful persistence for processed
  messages.
- Telegram notification failure should not lose findings.
- Duplicate findings should be avoided by normalized claim deduplication.
- Confirmed and uncertain stats must remain separate.

## Testing Strategy

Unit tests:

- Structured-output schemas for extraction and verification.
- Source policy decisions.
- Deduplication key normalization.
- Telegram HTML escaping.
- Message URL building and fallback behavior.
- Stats aggregation by user, status, category, and time range.

Repository tests:

- SQLite migrations for the new tables.
- Insert/find findings and sources.
- Deduplication uniqueness.
- Window watermark updates.

Integration tests:

- Hourly scheduler flow with fake AI, fake search, and fake messenger.
- High-stakes confirmed finding sends immediate reply.
- Ordinary confirmed finding appears in hourly digest.
- Uncertain finding appears in the separate digest section.
- Failed search produces uncertain or failed-run behavior without losing the
  whole batch.

## Future Extensions

- Per-chat enable/disable and schedule settings.
- Chat commands for browsing findings.
- Admin-only correction or dispute workflow.
- Manual re-check of a finding.
- Retention policies or export controls.
- Better source provider selection by category.
- Fact-check prompt tuning based on false positives.
