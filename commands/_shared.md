# Team Skill Crew -- Shared Context (Core)

> **Every `/team:*` subcommand MUST load this file first.**
> Additional context tiers are loaded only by commands that need them.

---

## Governance Layer

1. Read repo `AGENTS.md` + `.claude/rules/`
2. Coding principles (first found wins): repo `.claude/rules/coding-principles.md` → `~/.claude/team/reference/coding-principles.md` → defaults (KISS, DRY, YAGNI, SOLID, SoC)

---

<context>

## Path Helper

```
REPO_NAME = basename of git root, or basename of cwd, or "_default"
TEAM_DIR  = ~/.claude/team/repos/{REPO_NAME}
CONTRACTS       = {TEAM_DIR}/sessions/{TICKET}/contracts/    # Human-readable
DECISIONS_GLOBAL   = {TEAM_DIR}/decisions/global.md
DECISIONS_SESSION  = {TEAM_DIR}/sessions/{TICKET}/decisions.md
LEARNINGS       = {TEAM_DIR}/learnings/           # Domain files: ui.md, data.md, auth.md, testing.md, crew.md, migration.md, tooling.md
LEARNINGS_INDEX = {TEAM_DIR}/learnings/INDEX.md   # Always loaded — one-liner per entry
LEARNINGS_EDGES = {TEAM_DIR}/learnings/EDGES.md   # Relationship registry (loaded on demand)
GLOBAL_PATTERNS = ~/.claude/team/global/patterns/INDEX.md  # Cross-project patterns (opt-in, lower priority)
GLOBAL_EDGES    = ~/.claude/team/global/patterns/EDGES.md  # Cross-project relationships
STORY     = ~/.claude/team/story/
```

</context>

---

<constraints>

## Core Disciplines

These exist because each one prevents a specific, observed failure mode.

| # | Discipline | Why |
|---|-----------|-----|
| 1 | **Feature branch** — never commit on main/develop/master | Protects shared branches from half-finished work. Broken main blocks the entire team. |
| 2 | **Verification mandatory** — Sentinel runs commands, reads output, confirms pass | "Tests pass" without evidence is the #1 agent failure mode. Evidence-before-assertions. |
| 3 | **Anti-repetition** — scan learnings/INDEX.md before any approach | Without this, the same mistake repeats across sessions. Prior failures inform better plans. |
| 4 | **Devil's Advocate** — every plan challenged. PROCEED/REVISE/RETHINK | Catches wrong assumptions before expensive implementation. Cheap insurance. |
| 5 | **Simplify always runs** — after verify pass, simplify changed files | Code grows complex during implementation. A simplify pass catches accidental complexity while context is fresh. |
| 6 | **Intent check** — diff vs contract intent. Tests passing ≠ problem solved | Tests verify code correctness, not feature correctness. The diff must match what the user actually asked for. |
| 7 | **Smart PR** — UI touched → branch only. No UI → draft PR | UI changes need visual verification before PR. API/backend changes can go straight to review. |
| 8 | **Jira auto-transition** — after push/PR: transition + comment | Keeps project tracking in sync without manual overhead. Stakeholders see real-time progress. |
| 9 | **Learnings** — every session reads and writes learnings | The knowledge system only works if it's fed. Reading prevents repeated mistakes; writing prevents knowledge loss. |
| 10 | **Auto-CREW trigger** — 4+ files, 2+ packages, cross-cutting → CREW | Large changes benefit from parallel agents. A single agent doing 10 file edits sequentially wastes time and context. |
| 11 | **Root cause or nothing** — reproduce → trace → confirm → fix | Stacking patches on a wrong hypothesis makes the real problem harder to find. Diagnosis before treatment. |
| 12 | **Parallel agents** — 2+ independent files → parallel spawn | Independent work should run concurrently. Sequential when parallel is possible wastes wall-clock time. |
| 13 | **Subagent-driven always** — all implementation through Agent tool | Keeps Cortex context clean for coordination. Implementation details in subagents don't pollute the orchestrator. |

See `reference/governance.md` for enforcement details.

</constraints>

<verify_before_claiming_done>

### Self-Check (before claiming "done")

- [ ] On feature branch (not main/develop)?
- [ ] Verification commands ran and output read?
- [ ] Anti-repetition checked before starting?
- [ ] Devil's Advocate reviewed the plan?
- [ ] Simplify ran on all changed files?
- [ ] Cortex checked intent alignment (not just test pass)?
- [ ] Learnings recorded?
- [ ] ALL implementation went through the Agent tool — Cortex never edited directly?

If ANY is NO → fix before proceeding.

See `reference/governance.md` for additional rules and output style.

</verify_before_claiming_done>

---

<context_management>

## Context Management

| Threshold | Action |
|-----------|--------|
| Under 30% | Full capacity — complex reasoning, multi-step plans OK |
| 30-40% | **Caution** — consider proactive compact. Wrap subagent work. |
| 40-60% | **Compact NOW** — quality is degrading. Use `/compact focus on [task]`. |
| Over 60% | **Emergency** — finish current step and start fresh session. |

**Rules:** Always compact with hints (never bare `/compact`). Rewind over correct (failed attempts pollute context). Subagents for heavy reads. After compact: re-read `intent.md` + active contracts.

See `_shared-auto-learning.md` for smart learnings loading strategy and domain detection.

</context_management>

---

## Preamble Tiers

Each command declares a complexity tier (T1-T4). Load ONLY the context for that tier. This saves 40-60% tokens on simple commands.

### Tier Definitions

| Tier | Description | Shared Contexts Loaded | Iron Laws Active |
|------|-------------|----------------------|-----------------|
| **T1** | Leaf commands — read-only or single action | `_shared.md` only (Governance + Iron Laws + Context Mgmt) | 1-3 only |
| **T2** | Verification — run checks, diagnose, report | + `_shared-repo-detection.md` + `_shared-auto-learning.md` | 1-3, 5, 11 |
| **T3** | Planning — research, plan, discuss, review | + `_shared-crew.md` + `_shared-discipline.md` + `_shared-contracts.md` | All except 12-13 |
| **T4** | Full orchestration — plan + execute + verify | ALL shared contexts | All |

### Command → Tier Mapping

| Tier | Commands |
|------|----------|
| **T1** | `status`, `sessions`, `health`, `learn`, `note`, `scout` |
| **T2** | `verify`, `fix`, `validate`, `eval`, `detective` |
| **T3** | `review`, `contract`, `recruit`, `visual` |
| **T4** | `start`, `execute`, `wrap`, `resume`, `pause` |

### Shared Context Files

| File | T1 | T2 | T3 | T4 | Purpose |
|------|----|----|----|----|---------|
| `_shared.md` | Y | Y | Y | Y | Core governance, Iron Laws, paths, context management |
| `_shared-repo-detection.md` | | Y | Y | Y | Stack detection, verification commands |
| `_shared-auto-learning.md` | | Y | Y | Y | Read/write learnings after work |
| `_shared-crew.md` | | | Y | Y | Agent spawning, crew roles |
| `_shared-discipline.md` | | | Y | Y | Plan/execution discipline |
| `_shared-contracts.md` | | | Y | Y | Contract templates, hooks |
| `_shared-detective.md` | | Y* | | Y | Forensic analysis (loaded on detective trigger) |
| `_shared-board.md` | | | | Y | Event log, session state |
| `_shared-phantom-integration.md` | | | | Y | Graph intelligence (optional) |
