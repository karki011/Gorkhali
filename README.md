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
~/.claude/phantom/
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
├── state/             # Global (non-ticket) state: evolution-log, hook-session snapshots
├── hooks/             # Structural enforcement
├── learnings/         # Scored knowledge with decay
├── repos/             # Per-repo state (under ${PHANTOM_DATA:-~/.claude/phantom-data})
│   └── {REPO_NAME}/
│       ├── sessions/      # Per-ticket JSON artifacts (source of truth) — sessions/{TICKET}/
│       └── learnings/     # Per-repo scored knowledge
├── templates/         # Reusable contract templates
└── global/            # Cross-repo patterns
```

## Shadows

| Agent | Model | Effort | Role |
|-------|-------|--------|------|
| Apex | opus | xhigh | Orchestrator — plans, decomposes, coordinates, runs router |
| Blade | opus | xhigh | Implementation — parallel execution with ROLE FOCUS directives |
| Ward | opus | medium | QA — lint, build, test verification |
| Gaze | opus | high | Quality gate — power level (scored, P0-P3) |
| Sage | opus | max | Advisory — guidance for stuck agents (<100 words) |
| Lens | opus | medium | Visual verification — screenshot + diff |
| Archer | opus | high | Cross-file review — pre-PR structural analysis |
| Rival | opus | high | Plan challenger — adversarial review (no tools, forced precision) |
| Hound | opus | xhigh | Forensic investigator — 7-step protocol, HTML reports |
| Sweep | opus | low | Code clarity — simplify changed files post-verify |
| Base Agent | — | — | Template for spawning new agent types |

All agents run on `opus` (resolves to Claude Opus 4.8), differentiated by per-agent `effort` level set in each agent's subagent definition frontmatter. No version restrictions. `plan-checker` (the registered Rival subagent) runs at `high`. `haiku` is reserved for truly mechanical single-file edits.

## Opus 4.8 & Effort

Phantom runs on a single model (`opus` → Claude Opus 4.8) and differentiates agents by the **`effort`** parameter (levels: low / medium / high / xhigh / max). Effort governs all tokens including tool calls — lower effort means fewer tool calls. Default is `high` on all surfaces including Claude Code; per-agent effort is set in each agent's subagent definition frontmatter (`agents/*.md`).

**Recommended: run Phantom in ultracode mode** (`/effort ultracode`) for any multi-agent session. Ultracode pairs `xhigh` effort with standing permission for multi-agent/subagent orchestration — built exactly for Phantom's shadow-army pattern. `xhigh` is Anthropic's recommended starting point for coding and agentic work.

Opus 4.8 also improves tool triggering (less likely to skip a required tool call, reinforcing the subagent-driven law) and long-context + compaction recovery (smoother pause/resume sessions).

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
git clone git@github.com:Cloudzero/research-phantom-skills.git ~/.claude/phantom
~/.claude/phantom/setup.sh
```

Prerequisites: Claude Code CLI, git. Recommended: gh CLI, Atlassian MCP. Optional: phantom-ai MCP, Slack MCP, code-review-graph MCP.

## Author

Subash Karki
