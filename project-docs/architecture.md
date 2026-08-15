# Architecture and Key Concepts

How the adaptive cognitive router classifies a task, the concepts each route relies on, and the per-repo knowledge layer behind them.

## Architecture - Adaptive Cognitive Router

The router classifies incoming tasks and selects the right cognitive mode:

```
                        ┌─────────────────┐
                        │   User Input    │
                        └────────┬────────┘
                                 │
                    ┌────────────┴────────────┐
                    │  Phase A: Context +     │
                    │  Classify (signals:     │
                    │  scope, uncertainty,    │
                    │  risk, confidence)      │
                    └────────────┬────────────┘
                                 │
            ┌────────┬───────────┼───────────┬────────┐
            ▼        ▼           ▼           ▼        │
        DIRECT     PLAN    BRAINSTORM     FULL        │
        <3 files   3+ files  ambiguous   cross-cutting│
        known      clear     or new      multi-system │
        pattern    scope     domain      risky        │
            │        │           │           │        │
            │    Planner ←→  Brainstorm  Brainstorm   │
            │    Challenger   → Plan      → Plan      │
            │    (2 rounds)   → Execute   → Wire      │
            │        │           │        → Execute    │
            ▼        ▼           ▼           ▼        │
         Execute  Execute     Execute     Execute     │
            │        │           │           │        │
            ▼        ▼           ▼           ▼        │
         Verify   Verify      Verify      Verify     │
            │        │           │           │        │
            └────────┴───────────┴───────────┘        │
                                 │                    │
                    ┌────────────┴────────────┐       │
                    │       Wrap / Ship       │◄──────┘
                    └─────────────────────────┘
```

**Human intervention scales with uncertainty, not task size.** A big but well-understood refactor may need zero human input. A small but novel integration may need brainstorming.

## Key Concepts

**Adaptive Routing** - AI reads the task and picks the route. Signals: scope clarity, file count, uncertainty level, risk, learnings history. See `reference/router.md`.

**Deliberative Planning** - Planner produces plan, Challenger (Rival) both challenges and validates it, leaving a `plan-check.json` verdict. If consensus → human gets a quick OK. If disagreement → human breaks the tie. Max 2 rounds.

**Brainstorm Mode** - Diverge/converge for ambiguous scope. Proposes 2-3 approaches with tradeoffs. Asks only what it can't infer from codebase context. See `reference/brainstorm.md`.

**Wiring Mode** - Novel: explicit dependency topology between plan tasks. Maps producers/consumers, assigns parallel execution waves, flags integration risk points. No other system does this. See `reference/wiring.md`.

**Core Disciplines** - 15 rules, each with a WHY explaining the failure mode it prevents. Enforced structurally via hooks and artifact schemas, not prompt ceremony.

**Power Level** - P0 (critical) + P1 (high) auto-fix. P2 (medium) + P3 (low) dropped.

**Direct HTML Review** - For plan and brainstorm gates, the active AI authors a self-contained candidate HTML page from canonical JSON. A local validator promotes it to the accepted artifact, which opens directly; approval and feedback stay in the existing chat. Visualflow artifacts also open directly, with feedback captured in chat.

**Anti-Repetition** - Scans learnings before every approach. `[failed]` entries are blocked. `[validated:5+]` entries auto-apply.

**Self-Evolution** - Tier 0: external absorption (user approval). Tier 1: reference auto-promote. Tier 2: skill edits (user approval). Tier 3: skill spawning (user approval).

**Final Status Block** - every skill ends with a clear 🟢 done / 🟡 done-with-caveat / 🔴 blocked work-state signal.

## Repo Brain

**Per-session distilled knowledge cards.** After every session, Phantom writes a lightweight card to the Repo Brain - one card per ticket. Cards live in `${PHANTOM_DATA}/repos/{REPO_NAME}/brain/cards/` as markdown files and grow monotonically (never deleted, only superseded). On-demand grep retrieval retrieves relevant cards at task start (see `commands/_shared-brain.md` for the retrieval query, and `reference/brain.md` for the card schema).

**Auto-migration on first run:** Branch-named repo dirs (leftover from old detection logic) are consolidated on first run via `scripts/migrate-repo-dirs.js` - idempotent and non-destructive.
