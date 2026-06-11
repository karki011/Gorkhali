# Phantom Shadows -- Shared Context (Core)

> **Every `/phantom:*` subcommand MUST load this file first.**

## Governance

1. Read repo `AGENTS.md` + `.claude/rules/`
2. Coding principles (first found): repo `.claude/rules/coding-principles.md` → `${CLAUDE_PLUGIN_ROOT}/reference/coding-principles.md` → defaults

<context>

## Paths

```
PLUGIN_ROOT = ${CLAUDE_PLUGIN_ROOT}   # guaranteed by Claude Code for plugin-loaded commands/agents/hooks
              # legacy `install.sh --legacy` symlink installs run OUTSIDE plugin context (var unset there):
              # resolve to the clone dir instead — ${PHANTOM_INSTALL_DIR:-~/.claude/phantom}
              # EXCEPTION: commands/learn.md + reference/wrap/learnings.md keep the literal
              # ${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/phantom} fallback INTENTIONALLY — they are
              # executable shell guards (bash cannot resolve prose conventions), and the fallback
              # keeps caveman-compress working on legacy clone installs. Do NOT change those two.

Symbolic placeholders — defined HERE only (single home); resolve per-repo, never hardcode:
{TEST_CMD} {LINT_CMD} {BUILD_CMD} {TYPECHECK_CMD} = discovery protocol in reference/verification.md
{PKG_MGR}  = lockfile table in _shared-repo-detection.md
{DEV_PORT} = repo dev-server config

REPO_NAME = $PHANTOM_REPO if set, else basename of git root, else "_default"
TEAM_DIR  = ${PHANTOM_DATA:-~/.claude/phantom-data}/repos/{REPO_NAME}   # default ~/.claude/phantom-data; override with PHANTOM_DATA env
CONTRACTS       = {TEAM_DIR}/sessions/{TICKET}/contracts/
DECISIONS_GLOBAL   = {TEAM_DIR}/decisions/global.md
DECISIONS_SESSION  = {TEAM_DIR}/sessions/{TICKET}/decisions.md
LEARNINGS       = {TEAM_DIR}/learnings/
LEARNINGS_INDEX = {TEAM_DIR}/learnings/INDEX.md
LEARNINGS_EDGES = {TEAM_DIR}/learnings/EDGES.md
GLOBAL_PATTERNS = ${PHANTOM_DATA:-~/.claude/phantom-data}/global/patterns/INDEX.md
GLOBAL_EDGES    = ${PHANTOM_DATA:-~/.claude/phantom-data}/global/patterns/EDGES.md
```

</context>

<constraints>

## Core Disciplines

14 rules preventing observed failures. Full enforcement details: `reference/governance.md`.

1. **Feature branch** — never default/protected branches (configurable via `git.protected_branches` / `PHANTOM_PROTECTED_BRANCHES`)
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
14. **Workflow delegation** — BIG gateless fan-out → RECOMMEND a Claude Code dynamic workflow (user triggers; Apex can't self-launch). See `reference/workflow-delegation.md`.

</constraints>

### Self-Check (before "done")

All true? Feature branch, verify ran, anti-repetition, rival, simplify, intent, learnings, subagent-only. If ANY no → fix first.

## Learning & Self-Correction
- When user corrects or rejects an approach: STOP, acknowledge the correction, record it to `${PHANTOM_DATA:-~/.claude/phantom-data}/repos/{REPO_NAME}/learnings/{domain}.md` as `CORRECTION [{keyword}]: [{wrong}] — [{right}] [failed] ({date})`, then resume with corrected approach. Never repeat a corrected mistake.
- Before proposing any approach: scan learnings INDEX.md for matching corrections. Corrections with `[validated:5+]` = auto-apply. `[failed]` = blocked (must explain why different). Never ignore past failures.
- If a fix attempt fails twice with the same error class: STOP patching. The approach is wrong. Re-plan from scratch with failure context. Do not stack patches on a wrong hypothesis.
- After EVERY verification pass: run `simplify` on all changed files. Not optional. Not "if time permits." If simplify produces changes, re-verify before proceeding.

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
