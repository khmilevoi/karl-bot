# AI Behavior Evolution — Flow Diagrams

Companion to [2026-05-28-ai-behavior-evolution-design.md](2026-05-28-ai-behavior-evolution-design.md). Visual overview of the new runtime behavior. Local-only artifact (not committed).

## 1. Live message pipeline

Every message is stored, then either bypasses the gate (direct trigger) or goes through batched gating. A passing decision runs `decideBehavior`, which emits both visible actions and low-risk durable patches in one call.

```mermaid
flowchart TD
    msg([Telegram message]) --> store[Message storage - append-only]
    store --> trig{Direct or name trigger?}

    trig -- yes --> flush[Flush open batch into contextMessageIds]
    trig -- no --> batch[Per-chat batch accumulator]

    batch --> flushcond{Flush? size cap or hard-cap age or idle gap}
    flushcond -- not yet --> batch
    flushcond -- flush --> gate[Cheap behavior gate - triggerGate slot - one call per batch]
    gate --> sd{shouldDecide?}
    sd -- false --> stop[Store only and stop - no action, no state change]
    sd -- true --> ctx

    flush --> ctx[Context Assembly - recent window plus summary plus state plus trigger/context overlay]
    ctx --> decide

    decide{{decideBehavior - behaviorDecision slot - structured JSON}}
    risk[/gate stateImpactRisk high then start on stronger model/]
    risk -.-> decide

    decide --> validate[Validator plus PatchPolicy plus RateLimiter]
    validate -. on failure .-> errlog[(ai_error_events)]
    validate --> exec[BehaviorExecutor]

    exec --> actions[Visible/runtime actions - reply, react, ask_question, summarize_thread, or empty set]
    exec --> live[Live patches - UserProfilePatch plus TruthPatch]

    actions --> tg([Telegram])
    live --> applic[StatePatchApplicator - best-effort, independent, recompute trust and distance]
    applic --> profiles[(user_social_profiles)]
    applic --> truths[(bot_truths)]

    decide --> events[(behavior_events)]
```

Notes:

- The trigger mechanism is a **free heuristic pre-filter**; only non-triggered messages cost a gate call, and the gate runs **once per batch**, not per message.
- `summarize_thread` does not summarize inline — it only enqueues/bumps the single background summarizer.
- An **empty action set is valid** ("do nothing visible"); durable patches may still apply.

## 2. Background state-evolution pass

Slow, high-impact state (personality + politics) and descriptive snapshots are handled off the live path, on a stronger model, on its own cadence.

```mermaid
flowchart TD
    events[(behavior_events)] --> thr{New events since high-water mark >= N_evo AND cooldown passed?}
    sweep[Periodic cron sweep] -. floor: waited beyond T_max .-> enqueue
    thr -- yes --> enqueue[Enqueue per-chat job - single deduplicated worker]
    thr -- not yet --> idle[wait]

    enqueue --> pass{{State-evolution pass - stateEvolution slot - stronger model}}
    riskp[/batch stateImpactRisk high then raise priority and review patches with stronger model/]
    riskp -.-> pass

    pass --> reads[Read delta since high-water mark plus current rendered state]
    reads --> propose[Propose EvolutionPatch - personality.add_signal and politics.* patches]
    reads --> derive[Derive snapshots - personality arrays/enums and profile communication/conflict/tone/interests]

    propose --> pol[PatchPolicy - political stricter, weak claims to uncertainty]
    pol --> applic2[StatePatchApplicator]
    derive --> applic2
    applic2 --> per[(bot_personality_states)]
    applic2 --> polst[(bot_political_states)]
    applic2 -. re-derive descriptive fields .-> usp[(user_social_profiles)]

    pass --> hw[Advance high-water mark]
    pass --> ev2[(behavior_events - modelSlot stateEvolution)]
```

## 3. State ownership — which lane writes what

Two write lanes, four durable state stores, plus runtime-derived fields. No lane writes another's tables, so the lanes never race.

```mermaid
flowchart LR
    subgraph LIVE[Live lane - decideBehavior]
      lp[LiveStatePatch<br/>user.adjust_affinity, user.add_label,<br/>user.add_pattern, user.add_grudge,<br/>user.contest_profile_signal,<br/>truth.add/reinforce/contest/revise]
    end
    subgraph EVO[Background - state-evolution pass]
      ep[EvolutionPatch<br/>personality.add_signal,<br/>politics.add_position/adjust_position/add_uncertainty<br/>plus snapshot derivation]
    end

    lp --> usp[(user_social_profiles<br/>affinity, labels, patterns, grudges)]
    lp --> tr[(bot_truths)]
    ep --> per[(bot_personality_states)]
    ep --> pol[(bot_political_states)]
    ep -. derive descriptive fields .-> usp

    usp -. applicator recompute .-> derived[/trustLevel and preferredDistance/]
```

Field kinds inside `user_social_profiles`:

| Kind | Fields | Written by |
| --- | --- | --- |
| Event-patched | `affinityScore`, `labels`, `patterns`, `grudges` | live `decideBehavior` patches |
| Runtime-derived | `trustLevel`, `preferredDistance` | `StatePatchApplicator` (never patched) |
| Descriptive snapshot | `communicationStyle`, `conflictStyle`, `preferredTone`, `interests` | state-evolution pass derivation |

## 4. Model routing

```mermaid
flowchart LR
    g[triggerGate<br/>gpt-5.4-nano/mini] --> d
    d[behaviorDecision<br/>gpt-5.4-mini] -. escalate: schema retry, low confidence,<br/>conflicting actions, risky patches,<br/>or gate risk = high .-> d5[gpt-5.5]
    s[summarization<br/>gpt-5.4-mini] -. large context .-> s5[gpt-5.5]
    e[stateEvolution<br/>gpt-5.4-mini] -. political / high-impact personality .-> e5[gpt-5.5]
    r[errorRepair<br/>gpt-5.4-mini] -. repeated/unclear failure .-> r5[gpt-5.5]
```

Principle: cheapest model that is safe; escalate only on durable-state / politics / safety / user-visible-quality risk. The gate never changes state or sends actions.

## Key invariants

- **No hard deletes** — "removal" is always a status flag (`inactive` / `superseded` / `reversed`); every `evidenceMessageIds` reference stays valid forever.
- **Reversibility is evidence-based, not time-based** — no decay; later evidence strengthens, contests, or reverses earlier state.
- **AI output is advisory** — validators and policies decide what is actually applied; patches apply best-effort and independently.
- **Blank-slate** — absence of a per-chat state row renders as neutral defaults; personality/politics emerge only from chat evidence, with no privileged admin override.
