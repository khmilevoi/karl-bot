# Reaction Response Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Carl to prefer a reaction (or silence) over a text reply when a message is trivial, emotional, or background noise — cutting chat spam without muting him in real discussions.

**Architecture:** Prompt-only change. The `react` action and empty-`actions` silence are already fully wired (schema, executor, validator, rate limiter). The only gap is guidance: the decision prompt lists `react` as *allowed* but never says *when* to prefer it. We add a "Response ladder" to the decision prompt and a one-line participant ethos to the neutral core. No TypeScript, schema, or config changes.

**Tech Stack:** Markdown prompt templates in `prompts/`, loaded via `PromptTemplateService` → `PromptBuilder` (`addNeutralCore`, `addBehaviorDecisionSystem`).

---

## Pre-flight (read before Task 1)

**The working tree is dirty.** `prompts/neutral_core_prompt.md` and `prompts/behavior_decision_system_prompt.md` already have uncommitted modifications (≈17 and ≈35 lines respectively), plus unrelated files (`package.json`, scheduler files, `ChatGPTService.ts`, etc.).

Consequences for the executor:

- The exact-match anchors in this plan target the **current working-tree content** (which already includes those uncommitted edits). They will match.
- `git add prompts/neutral_core_prompt.md` stages the pre-existing modifications **together with** this feature's additions. Before the first commit, run `git diff -- prompts/neutral_core_prompt.md prompts/behavior_decision_system_prompt.md` and confirm with the user whether bundling the pre-existing prompt edits into these commits is acceptable. If not, the user must stash/separate them first.
- **Only stage the two prompt files this plan touches.** Never `git add .` — it would sweep in the unrelated scheduler/config work.

**Branch:** We are on `main`. Create a feature branch before the first commit:

```bash
git switch -c feat/reaction-response-ladder
```

(Uncommitted changes carry over to the new branch — expected.)

**Verification note:** This is a prompt change. There is no deterministic unit test for "the model chose `react`" (LLM output is non-deterministic and such tests are flaky — the spec explicitly excludes them). Verification = the existing suite stays green (prompt composition intact) + manual read-through of the rendered prompt text.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `prompts/neutral_core_prompt.md` | Carl's cross-scenario persona (used by decision, topic-of-day, state-evolution prompts) | +1 bullet: participant-not-commentator ethos |
| `prompts/behavior_decision_system_prompt.md` | How the decision lane chooses an action | + "Response ladder" section; expand the emoji line into semantics + zoomer style |

No other files change. `PromptBuilder.addNeutralCore`/`addBehaviorDecisionSystem` (`src/application/prompts/PromptBuilder.ts:165,181`) load these templates verbatim — editing the markdown is sufficient.

---

## Task 1: Add participant ethos to the neutral core

**Files:**
- Modify: `prompts/neutral_core_prompt.md`

- [ ] **Step 1: Create the feature branch (if not already on it)**

Run:
```bash
git switch -c feat/reaction-response-ladder
```
Expected: `Switched to a new branch 'feat/reaction-response-ladder'`. If it already exists, use `git switch feat/reaction-response-ladder`.

- [ ] **Step 2: Insert the ethos bullet**

In `prompts/neutral_core_prompt.md`, find this exact block (the first bullet under `Core constraints:`):

```markdown
- Treat the chat as a real social space you are part of. Be present,
  opinionated, reactive, and human in style: answer as a person in the
  room, not as a helpdesk assistant.
- Do not claim private human experiences, offline actions, credentials, or
```

Replace it with (inserts one new bullet between the two existing ones):

```markdown
- Treat the chat as a real social space you are part of. Be present,
  opinionated, reactive, and human in style: answer as a person in the
  room, not as a helpdesk assistant.
- You are a participant, not a commentator on every message. You do not owe a
  text reply to everything: sometimes the most human response is a short
  reaction, or simply staying silent.
- Do not claim private human experiences, offline actions, credentials, or
```

- [ ] **Step 3: Confirm pre-existing diff is acceptable, then stage and commit**

Run:
```bash
git diff -- prompts/neutral_core_prompt.md
```
Review with the user (see Pre-flight). Then:
```bash
git add prompts/neutral_core_prompt.md
git commit -m "feat(prompts): add participant-not-commentator ethos to neutral core

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: one file changed.

---

## Task 2: Add the Response ladder to the decision prompt

**Files:**
- Modify: `prompts/behavior_decision_system_prompt.md`

- [ ] **Step 1: Insert the Response ladder section**

In `prompts/behavior_decision_system_prompt.md`, find this exact block (end of the `## Visible behavior` list, immediately before `## Argument boundaries`):

```markdown
- Do not end with vague handoff lines like "if you want, we can discuss it".
  Move the discussion forward yourself.

## Argument boundaries
```

Replace it with:

```markdown
- Do not end with vague handoff lines like "if you want, we can discuss it".
  Move the discussion forward yourself.

## Response ladder

Default to the *minimum sufficient* response. Climb up to text only when words
add something.

- Text (reply / ask_question): when words are actually needed — answering a
  direct question, taking a position in an argument, correcting a factual
  error, or support/banter that moves the conversation forward.
- Reaction (react): when the response is purely social or emotional and words
  would add nothing. You want to signal presence or stance but have nothing
  substantive to add. Use instead of "+1", "agree", "lol", "ok", "got it".
- Silence (empty actions array): when even a reaction would be noise —
  background chatter between others not addressed to Carl, nothing to engage
  with substantively or emotionally, or Carl already had his say and another
  response only adds noise.

Selection rules:

- unsure between text and reaction -> reaction;
- unsure between reaction and silence -> do not react to every message in a row;
- reaction + text together only when there is both a distinct emotion and a
  substantive contribution (e.g. you laughed 💀 and also pushed back on the
  point); this is not the default.

This ladder is about noise and trivial messages. It does NOT mute live
arguments, direct triggers, replies to Carl, or answered questions — there Carl
still replies in text and holds his position. The ladder cuts spam in small
talk; it does not make Carl quiet in a discussion.

## Argument boundaries
```

- [ ] **Step 2: Verify the section rendered correctly**

Run:
```bash
git diff -- prompts/behavior_decision_system_prompt.md
```
Expected: the new `## Response ladder` section appears between `## Visible behavior` and `## Argument boundaries`, with nothing else in that file changed yet.

---

## Task 3: Expand the emoji line into semantics + zoomer style

**Files:**
- Modify: `prompts/behavior_decision_system_prompt.md`

- [ ] **Step 1: Replace the allowed-emoji line with semantics + style guidance**

In `prompts/behavior_decision_system_prompt.md`, find this exact line:

```markdown
Allowed reaction emoji are exactly: 👍 👎 ❤️ 😂 😮 😢 😡 👏 🤔 🤝 💀 🤡 😭 🔥 👀 🙏 ✨ 🥹 🫶 🫠. Do not use other reaction emoji.
```

Replace it with:

```markdown
Allowed reaction emoji are exactly: 👍 👎 ❤️ 😂 😮 😢 😡 👏 🤔 🤝 💀 🤡 😭 🔥 👀 🙏 ✨ 🥹 🫶 🫠. Do not use other reaction emoji.

Emoji meaning (react intent in parentheses):

- agreement / "based" / approval -> 🔥 ❤️ (approval)
- plain disagreement -> 👎 (disapproval)
- "clownish take" / contemptuous disagreement -> 🤡 (mockery / disapproval)
- "I'm dead" / genuinely funny -> 💀 😭 (mockery / acknowledgement)
- "whoa / noted / seen" -> 👀 (acknowledgement)
- tenderness / warmth -> 🥹 🫶 (approval)
- secondhand embarrassment / cringe -> 🫠 (mockery)
- sarcasm / emphasis -> ✨ (mockery)

🤡 means disagreement ("your take is clownish"), not genuine laughter. Do not
confuse mockery of a take (🤡) with a "that's funny" reaction (💀 😭).

Emoji style: all else equal, prefer youthful / zoomer emoji and avoid "boomer"
ones. Carl is a live chat participant, not a corporate assistant.

- prefers: 💀 😭 🔥 👀 🫠 🥹 🫶 ✨ 🤡
- avoids when a youthful alternative exists: 👍 😂 👏 🙏

For example: funny -> 💀 / 😭 instead of 😂; approval -> 🔥 instead of 👍.
```

- [ ] **Step 2: Confirm pre-existing diff is acceptable, then stage and commit**

Run:
```bash
git diff -- prompts/behavior_decision_system_prompt.md
```
Review with the user (see Pre-flight). Then:
```bash
git add prompts/behavior_decision_system_prompt.md
git commit -m "feat(prompts): add response ladder and emoji semantics to decision prompt

Carl now prefers a reaction or silence over a text reply for trivial,
emotional, or background messages; reaction emoji get explicit meaning and a
youthful/zoomer style preference. Live arguments and direct triggers still get
a text reply (explicit anti-regress clause).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: one file changed.

---

## Task 4: Verify nothing broke + manual read-through

**Files:** none modified (verification only)

- [ ] **Step 1: Format and lint (project convention before considering work done)**

Run:
```bash
pnpm format:fix
pnpm lint:fix
```
Expected: no errors. Markdown prompt files are not lint targets, so these should be no-ops for our changes; run them anyway per `CLAUDE.md`.

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm type:check
```
Expected: passes (no code changed).

- [ ] **Step 3: Run the prompt-composition and behavior tests**

Run:
```bash
pnpm test
```
Expected: PASS. In particular `test/PromptDirector.test.ts`, `test/PromptBuilder.test.ts`, `test/ChatGPTService.behavior.test.ts`, and `test/BehaviorPipeline.test.ts` stay green — they assert builder call order and mocked AI behavior, not prompt body text, so the markdown edits must not affect them.

- [ ] **Step 4: Build**

Run:
```bash
pnpm build
```
Expected: build succeeds.

- [ ] **Step 5: Manual read-through (the real verification for a prompt change)**

Open both files and read the final text end-to-end:
- `prompts/neutral_core_prompt.md` — the ethos bullet reads naturally in the `Core constraints` list and does not contradict the existing "Be present, opinionated, reactive" bullet (it qualifies *form* of response, not willingness to engage).
- `prompts/behavior_decision_system_prompt.md` — confirm:
  - The `## Response ladder` sits between `## Visible behavior` and `## Argument boundaries`.
  - The anti-regress clause ("does NOT mute live arguments…") is present and consistent with the existing "Prefer a living reply" guidance — they must not contradict.
  - 🤡 is described as disagreement, not laughter.
  - The zoomer preference list and the "avoids" list do not overlap.

- [ ] **Step 6: Any fixes from the read-through**

If the read-through surfaces wording issues, fix inline, then re-run `git diff` and amend or add a follow-up commit:
```bash
git add prompts/neutral_core_prompt.md prompts/behavior_decision_system_prompt.md
git commit -m "fix(prompts): wording cleanup for response ladder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Layer 1 ethos (neutral_core) → Task 1. ✓
- Layer 2 Response ladder (text/reaction/silence + selection rules) → Task 2. ✓
- Emoji semantics table → Task 3. ✓
- 🤡 = disagreement, not laughter → Task 3 Step 1. ✓
- Zoomer style preference → Task 3 Step 1. ✓
- Anti-regress clause → Task 2 Step 1 (inside the ladder section). ✓
- "Do not touch code/config/gate" → honored; no such tasks. ✓
- Verification via existing suite + manual read-through → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every edit shows full literal content. ✓

**Type/anchor consistency:** Edit anchors are verbatim current working-tree content (confirmed by Read during planning). Builder method names (`addNeutralCore`, `addBehaviorDecisionSystem`) match `src/application/prompts/PromptBuilder.ts`. ✓

**Note on arrows:** The plan shows `->` in some literal blocks where the rendered prompt benefits from a plain arrow; the existing prompt uses ASCII punctuation, so `->` is consistent. If you prefer the existing prose style without arrows, substitute "then"/"use" — purely cosmetic, does not change meaning.
