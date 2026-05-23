# Team Skill v2 — Multi-Agent Orchestration for Claude Code

**Author: Subash Karki**

## What It Does

Orchestrates AI agents for software development. Takes a ticket or requirement, plans, executes with parallel agents, verifies with temperature-based review, and ships via PR with Greptile review and Jira transition. Self-evolving — learns from every session and compresses knowledge over time.

## Quick Start

```bash
/team:start CP-41606          # plan → execute → verify → ship
/team:verify                   # temperature review (P0/P1 fix, P2/P3 drop)
/team:wrap                     # commit, push, PR, Greptile, Jira
/team:pause → /clear → /team:resume CP-41606   # context management
```

## Architecture

- **Artifact-passing pipeline** — each phase reads/writes JSON to `state/sessions/`
- **Thin skills** — directives are 30-50 lines; reference material injected by hooks on demand
- **Structural enforcement** — hooks enforce Iron Laws (not prompting)
- **Knowledge compression** — learnings → reference promotion → skill evolution over time

## Folder Structure

```
~/.claude/team/
├── commands/          # Skill directives (30-80 lines each)
├── reference/         # On-demand reference (injected by hooks)
├── agents/            # Agent personas
├── state/             # JSON artifacts (source of truth)
│   ├── sessions/      # Active session artifacts
│   ├── completed/     # Archived sessions
│   └── evolution-log.json
├── hooks/             # Structural enforcement
├── learnings/         # Scored knowledge with decay
├── repos/             # Per-repo state
├── templates/         # Reusable templates
└── global/            # Cross-repo patterns
```

## Lifecycle

```
start → plan → execute → verify → wrap → done
                           ↑          │
                           └── fix ───┘
Context heavy? pause → /clear → resume
```

## Key Concepts

**Artifacts** — JSON files in `state/sessions/` with `_meta` headers. Files are truth, context is ephemeral.

**Temperature Review** — P0 (critical) + P1 (high) auto-fix. P2 (medium) + P3 (low) dropped. 1 agent, not 7.

**Self-Evolution** — Tier 1: reference auto-promote. Tier 2: skill edits (user approval). Tier 3: skill spawning (user approval).

**Haiku Sidecar** — Small LLM handles routing, validation, evolution, distillation.

**Iron Laws** — 13 rules, 10+ enforced structurally via hooks and artifact schemas.

## Crew

| Agent | Model | Role |
|-------|-------|------|
| Cortex | opus | Orchestrator — plans, decomposes, coordinates |
| Spark | sonnet | Implementation — parallel execution |
| Sentinel | sonnet | QA — lint, build, test verification |
| Prism | sonnet | Quality gate — temperature review (scored) |
| Oracle | opus | Advisory — guidance for stuck agents (<100 words) |
| Lens | sonnet | Visual verification — screenshot + diff |
| Hawkeye | opus | Cross-file review — pre-PR structural analysis |
| Devil's Advocate | opus | Plan challenger — adversarial review |

All models are 4.6 only — 4.7 is too slow.

## Skills Reference

| Command | Description |
|---------|-------------|
| `/team:start` | Plan + execute + verify + ship (main entry point) |
| `/team:verify` | Temperature review with auto-fix for P0/P1 |
| `/team:wrap` | Commit, push, PR, Greptile review, Jira transition |
| `/team:pause` | Save session state for context management |
| `/team:resume` | Restore session from saved state |
| `/team:fix` | Triage failures, assign scoped repairs, re-verify (max 3 loops) |
| `/team:status` | Current task board |
| `/team:review` | Trigger Prism quality gate |
| `/team:visual` | Trigger Lens visual inspection |
| `/team:scout` | Run background scouts for missing context |
| `/team:recruit` | Spawn a Spark with ROLE FOCUS directive |
| `/team:grill` | Quiz yourself on the diff before shipping |
| `/team:learn` | Capture a learning mid-session |
| `/team:evolve` | Trigger evolution check — scan learnings, propose promotions |
| `/team:health` | Diagnose knowledge layer health |
| `/team:eval` | Evaluate crew performance with rubric |
| `/team:sessions` | List all sessions with status |
| `/team:execute` | Execute a saved plan |
| `/team:contract` | Create contract from template (feature/api/testing/ui/fix) |
| `/team:validate` | Run validation checks (plan/output/session/all) |

## Hooks

| Hook | Type | Purpose |
|------|------|---------|
| `pre-phase-context.js` | PreToolUse | Injects reference content based on current session phase |
| `feature-branch-gate.sh` | PreToolUse | Blocks destructive operations on main/master |
| `validate-artifact.js` | PostToolUse | Validates JSON artifacts have proper `_meta` headers |
| `board-event-log.js` | PostToolUse | Logs task/decision events to `events/` NDJSON |
| `observation-capture.js` | PostToolUse | Captures Read/Edit/Write/Bash/Grep/Glob events with structural summaries to `observations/{date}.jsonl` |

**observation-capture** — passive context accumulation. Every tool use is silently recorded with compressed structural data (imports, exports, function counts, class names). Deduplicates within 60s windows. Observations stored as NDJSON, one line per event, max 500 chars each.

## Setup

```bash
# Fresh install
git clone git@github.com:Cloudzero/research-phantom-skills.git ~/.claude/team
~/.claude/team/setup.sh

# Update existing
cd ~/.claude/team && git pull && ./setup.sh
```

Prerequisites: Claude Code CLI, git. Recommended: gh CLI, Atlassian MCP. Optional: phantom-ai MCP, Slack MCP.

## Author

Subash Karki
