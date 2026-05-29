# Phantom Shadows -- Shared Context (Core)

> **Every `/phantom:*` subcommand MUST load this file first.**

## Governance

1. Read repo `AGENTS.md` + `.claude/rules/`
2. Coding principles (first found): repo `.claude/rules/coding-principles.md` → `~/.claude/phantom/reference/coding-principles.md` → defaults

<context>

## Paths

```
REPO_NAME = basename of git root, or basename of cwd, or "_default"
TEAM_DIR  = ~/.claude/phantom/repos/{REPO_NAME}
CONTRACTS       = {TEAM_DIR}/sessions/{TICKET}/contracts/
DECISIONS_GLOBAL   = {TEAM_DIR}/decisions/global.md
DECISIONS_SESSION  = {TEAM_DIR}/sessions/{TICKET}/decisions.md
LEARNINGS       = {TEAM_DIR}/learnings/
LEARNINGS_INDEX = {TEAM_DIR}/learnings/INDEX.md
LEARNINGS_EDGES = {TEAM_DIR}/learnings/EDGES.md
GLOBAL_PATTERNS = ~/.claude/phantom/global/patterns/INDEX.md
GLOBAL_EDGES    = ~/.claude/phantom/global/patterns/EDGES.md
```

</context>

<constraints>

## Core Disciplines

13 rules preventing observed failures. Full enforcement details: `reference/governance.md`.

1. **Feature branch** — never main/develop/master
2. **Verify** — run commands, read output, confirm
3. **Anti-repetition** — scan INDEX.md before planning
4. **Rival** — challenge every plan
5. **Simplify** — after verify pass
6. **Intent check** — diff vs contract
7. **Smart PR** — Draft PR default
8. **Jira transition** — after push/PR
9. **Learnings** — read + write every session
10. **Auto-SHADOWS** — 4+ files → parallel agents
11. **Root cause** — reproduce → trace → confirm → fix
12. **Parallel agents** — independent files → concurrent spawn
13. **Subagent-driven** — all edits via Agent tool

</constraints>

### Self-Check (before "done")

All true? Feature branch, verify ran, anti-repetition, rival, simplify, intent, learnings, subagent-only. If ANY no → fix first.

<context_management>

## Context Management

| Threshold | Action |
|-----------|--------|
| <30% | Full capacity |
| 30-40% | Caution — consider compact |
| 40-60% | **Compact NOW** |
| >60% | Emergency — finish step, fresh session |

Compact with hints. Subagents for heavy reads. After compact: re-read `intent.md` + contracts.

</context_management>

## Preamble Tiers

| Tier | Commands | Shared Contexts |
|------|----------|----------------|
| **T1** | status, sessions, health, learn, note, scout | `_shared.md` only |
| **T2** | verify, fix, validate, eval, hound | + repo-detection + auto-learning |
| **T3** | review, contract, recruit, visual | + shadows + discipline + contracts |
| **T4** | start, execute, wrap, resume, pause | ALL shared contexts |
