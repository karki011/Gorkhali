# PHANTOM — Your Shadow Army of AI Agents

**Author: Subash Karki**

> Inspired by Solo Leveling: you're the Monarch, your AI agents are the shadow army.
> Say `/phantom arise` and they answer.

## What It Does

Every task is a Gate. Phantom reads the difficulty, assembles the right shadows, and clears it. After every run, the system gains EXP — learning what works, remembering what doesn't.

Trivial tasks skip planning entirely. Ambiguous tasks brainstorm first. Complex tasks get full dependency wiring. Shadows deliberate among themselves; humans approve consensus or break ties.

Zero external plugin dependencies. Fully self-contained.

## Quick Start

```bash
/phantom:start CP-41606                    # router classifies → plan → execute → verify → ship
/phantom:start "the dashboard feels slow"  # ambiguous → brainstorm → plan → execute → verify
/phantom:verify                            # power level (P0/P1 fix, P2/P3 drop)
/phantom:wrap                              # commit, push, PR, Jira transition
/phantom:pause → /clear → /phantom:resume     # context management
```

## Architecture — Adaptive Cognitive Router

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

**Adaptive Routing** — AI reads the task and picks the route. Signals: scope clarity, file count, uncertainty level, risk, learnings history. See `reference/router.md`.

**Deliberative Planning** — Planner produces plan, Challenger (Rival) reviews it. If consensus → human gets a quick OK. If disagreement → human breaks the tie. Max 2 rounds.

**Brainstorm Mode** — Diverge/converge for ambiguous scope. Proposes 2-3 approaches with tradeoffs. Asks only what it can't infer from codebase context. See `reference/brainstorm.md`.

**Wiring Mode** — Novel: explicit dependency topology between plan tasks. Maps producers/consumers, assigns parallel execution waves, flags integration risk points. No other system does this. See `reference/wiring.md`.

**Core Disciplines** — 13 rules, each with a WHY explaining the failure mode it prevents. Enforced structurally via hooks and artifact schemas, not prompt ceremony.

**Power Level** — P0 (critical) + P1 (high) auto-fix. P2 (medium) + P3 (low) dropped.

**Anti-Repetition** — Scans learnings before every approach. `[failed]` entries are blocked. `[validated:5+]` entries auto-apply.

**Self-Evolution** — Tier 1: reference auto-promote. Tier 2: skill edits (user approval). Tier 3: skill spawning (user approval).

## Folder Structure

```
~/.claude/team/
├── commands/          # 21 skill directives (30-150 lines each)
├── reference/         # 16 reference files (on-demand, injected by hooks)
│   ├── router.md          # Classification algorithm, deliberation protocol
│   ├── brainstorm.md      # Diverge/converge protocol, question-asking rules
│   ├── wiring.md          # Dependency topology, wave assignments
│   ├── planning.md        # Machine-checkable criteria, anti-placeholder rules
│   ├── hound-protocol.md  # 7-step investigation with HTML reports
│   └── ...
├── agents/            # 11 agent personas
├── scripts/           # 4 deterministic helpers (no LLM needed)
│   ├── validate-artifact.js   # JSON schema validation
│   ├── check-learnings-index.js
│   ├── session-health.sh
│   └── preamble-tier.js
├── evals/             # 30 test cases for skill triggering verification
├── state/sessions/    # JSON artifacts (source of truth)
├── hooks/             # Structural enforcement
├── learnings/         # Scored knowledge with decay
├── repos/             # Per-repo state
├── templates/         # Reusable contract templates
└── global/            # Cross-repo patterns
```

## Shadows

| Agent | Model | Role |
|-------|-------|------|
| Apex | opus | Orchestrator — plans, decomposes, coordinates, runs router |
| Blade | sonnet | Implementation — parallel execution with ROLE FOCUS directives |
| Ward | sonnet | QA — lint, build, test verification |
| Gaze | sonnet | Quality gate — power level (scored, P0-P3) |
| Sage | opus | Advisory — guidance for stuck agents (<100 words) |
| Lens | sonnet | Visual verification — screenshot + diff |
| Archer | opus | Cross-file review — pre-PR structural analysis |
| Rival | opus | Plan challenger — adversarial review (no tools, forced precision) |
| Hound | sonnet | Forensic investigator — 7-step protocol, HTML reports |
| Sweep | sonnet | Code clarity — simplify changed files post-verify |
| Base Agent | — | Template for spawning new agent types |

All models are 4.6 only — 4.7 is too slow.

## Commands

| Command | Route | Description |
|---------|-------|-------------|
| `/phantom:start` | Entry | Adaptive router → classify → execute appropriate route |
| `/phantom:verify` | — | Power Level with auto-fix for P0/P1 |
| `/phantom:wrap` | — | Commit, push, PR, Jira transition |
| `/phantom:fix` | — | Triage failures, assign scoped repairs (max 3 loops) |
| `/phantom:pause` | — | Save session state for context management |
| `/phantom:resume` | — | Restore session from saved state |
| `/phantom:hound` | — | Forensic investigation with HTML report |
| `/phantom:review` | — | Trigger Gaze quality gate |
| `/phantom:visual` | — | Trigger Lens visual inspection |
| `/phantom:scout` | — | Background research agents |
| `/phantom:arise` | — | Spawn specialist agent (role focus) |
| `/phantom:grill` | — | Quiz yourself on the diff before shipping |
| `/phantom:contract` | — | Create contract (feature/api/testing/ui/fix) |
| `/phantom:execute` | — | Execute a saved plan |
| `/phantom:learn` | — | Capture a learning mid-session |
| `/phantom:evolve` | — | Scan learnings, propose promotions |
| `/phantom:health` | — | Diagnose knowledge layer |
| `/phantom:eval` | — | Evaluate shadows performance |
| `/phantom:validate` | — | Validate plan/output/session |
| `/phantom:sessions` | — | List all sessions with status |
| `/phantom:status` | — | Current task board |

## Independence

**Zero external plugin dependencies.** Previously depended on superpowers (14 skills), feature-dev, and code-sweep plugins. All have been:
- Superpowers: disabled, all 6 references replaced with own implementations
- Feature-dev: disabled, reference removed from gaze.md
- Code-sweep: absorbed into `agents/sweep.md` (plugin still enabled as backup, can be disabled)

## Setup

```bash
git clone git@github.com:Cloudzero/research-phantom-skills.git ~/.claude/team
~/.claude/team/setup.sh
```

Prerequisites: Claude Code CLI, git. Recommended: gh CLI, Atlassian MCP. Optional: phantom-ai MCP, Slack MCP, code-review-graph MCP.

## Author

Subash Karki
