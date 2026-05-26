# Team Skill v3 — Adaptive Cognitive Router for Claude Code

**Author: Subash Karki**

## What It Does

AI-native orchestration for software development. Takes any input — a ticket, a vague idea, a bug report — and adaptively routes it through the minimum viable ceremony. Trivial tasks skip planning entirely. Ambiguous tasks brainstorm first. Complex tasks get full dependency wiring. Agents deliberate among themselves; humans approve consensus or break ties.

Zero external plugin dependencies. Fully self-contained.

## Quick Start

```bash
/team:start CP-41606                    # router classifies → plan → execute → verify → ship
/team:start "the dashboard feels slow"  # ambiguous → brainstorm → plan → execute → verify
/team:verify                            # temperature review (P0/P1 fix, P2/P3 drop)
/team:wrap                              # commit, push, PR, Jira transition
/team:pause → /clear → /team:resume     # context management
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

**Deliberative Planning** — Planner produces plan, Challenger (Devil's Advocate) reviews it. If consensus → human gets a quick OK. If disagreement → human breaks the tie. Max 2 rounds.

**Brainstorm Mode** — Diverge/converge for ambiguous scope. Proposes 2-3 approaches with tradeoffs. Asks only what it can't infer from codebase context. See `reference/brainstorm.md`.

**Wiring Mode** — Novel: explicit dependency topology between plan tasks. Maps producers/consumers, assigns parallel execution waves, flags integration risk points. No other system does this. See `reference/wiring.md`.

**Core Disciplines** — 13 rules, each with a WHY explaining the failure mode it prevents. Enforced structurally via hooks and artifact schemas, not prompt ceremony.

**Temperature Review** — P0 (critical) + P1 (high) auto-fix. P2 (medium) + P3 (low) dropped.

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
│   ├── detective-protocol.md  # 7-step investigation with HTML reports
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

## Crew

| Agent | Model | Role |
|-------|-------|------|
| Cortex | opus | Orchestrator — plans, decomposes, coordinates, runs router |
| Spark | sonnet | Implementation — parallel execution with ROLE FOCUS directives |
| Sentinel | sonnet | QA — lint, build, test verification |
| Prism | sonnet | Quality gate — temperature review (scored, P0-P3) |
| Oracle | opus | Advisory — guidance for stuck agents (<100 words) |
| Lens | sonnet | Visual verification — screenshot + diff |
| Hawkeye | opus | Cross-file review — pre-PR structural analysis |
| Devil's Advocate | opus | Plan challenger — adversarial review (no tools, forced precision) |
| Detective | sonnet | Forensic investigator — 7-step protocol, HTML reports |
| Simplifier | sonnet | Code clarity — simplify changed files post-verify |
| Base Agent | — | Template for spawning new agent types |

All models are 4.6 only — 4.7 is too slow.

## Commands

| Command | Route | Description |
|---------|-------|-------------|
| `/team:start` | Entry | Adaptive router → classify → execute appropriate route |
| `/team:verify` | — | Temperature review with auto-fix for P0/P1 |
| `/team:wrap` | — | Commit, push, PR, Jira transition |
| `/team:fix` | — | Triage failures, assign scoped repairs (max 3 loops) |
| `/team:pause` | — | Save session state for context management |
| `/team:resume` | — | Restore session from saved state |
| `/team:detective` | — | Forensic investigation with HTML report |
| `/team:review` | — | Trigger Prism quality gate |
| `/team:visual` | — | Trigger Lens visual inspection |
| `/team:scout` | — | Background research agents |
| `/team:recruit` | — | Spawn specialist agent (role focus) |
| `/team:grill` | — | Quiz yourself on the diff before shipping |
| `/team:contract` | — | Create contract (feature/api/testing/ui/fix) |
| `/team:execute` | — | Execute a saved plan |
| `/team:learn` | — | Capture a learning mid-session |
| `/team:evolve` | — | Scan learnings, propose promotions |
| `/team:health` | — | Diagnose knowledge layer |
| `/team:eval` | — | Evaluate crew performance |
| `/team:validate` | — | Validate plan/output/session |
| `/team:sessions` | — | List all sessions with status |
| `/team:status` | — | Current task board |

## Independence

**Zero external plugin dependencies.** Previously depended on superpowers (14 skills), feature-dev, and code-simplifier plugins. All have been:
- Superpowers: disabled, all 6 references replaced with own implementations
- Feature-dev: disabled, reference removed from prism.md
- Code-simplifier: absorbed into `agents/simplifier.md` (plugin still enabled as backup, can be disabled)

## Setup

```bash
git clone git@github.com:Cloudzero/research-phantom-skills.git ~/.claude/team
~/.claude/team/setup.sh
```

Prerequisites: Claude Code CLI, git. Recommended: gh CLI, Atlassian MCP. Optional: phantom-ai MCP, Slack MCP, code-review-graph MCP.

## Author

Subash Karki
