# Straw Hat Engineering Crew -- Shared Context (Core)

> **Every `/team:*` subcommand MUST load this file first.**
> Additional context tiers are loaded only by commands that need them.

---

## Governance Layer

1. Read `AGENTS.md` from the repo root (or nearest ancestor)
2. Read `.claude/rules/` for repo-wide conventions
3. Core Principles: See `.claude/rules/coding-principles.md` for full list — key: **KISS**, **DRY**, **YAGNI**, **SOLID**, **SoC**, **CQS**, **TDA**, **GRASP**, **POLA**, **Contract-first**, **Codebase-first**

---

## Path Helper

```
REPO_NAME = basename of git root, or basename of cwd, or "_default"
TEAM_DIR  = ~/.claude/team/repos/{REPO_NAME}
BOARD_STATE     = {TEAM_DIR}/state/sessions/{TICKET}.json    # Board reads this
CONTRACTS       = {TEAM_DIR}/sessions/{TICKET}/contracts/    # Human-readable
DECISIONS_GLOBAL   = {TEAM_DIR}/decisions/global.md
DECISIONS_SESSION  = {TEAM_DIR}/sessions/{TICKET}/decisions.md
LEARNINGS       = {TEAM_DIR}/learnings/           # Domain files: ui.md, data.md, auth.md, testing.md, crew.md, migration.md, tooling.md
LEARNINGS_INDEX = {TEAM_DIR}/learnings/INDEX.md   # Always loaded — one-liner per entry
STORY     = ~/.claude/team/story/
```

---

## Enforced Workflow Rules

| Rule | Enforcement |
|------|-------------|
| **Semantic tokens only** | All UI code MUST use Chakra semantic tokens — never primitive hex or numbered scale values. |
| **Never write session JSON directly** | The board-sync hook is the ONLY writer of `state/sessions/{TICKET}.json`. Just use `TaskCreate`/`TaskUpdate` with `[CrewName]` prefixes. |
| **bypassPermissions for all agents** | All spawned agents use `mode: "bypassPermissions"`. Never ask for approval to spawn. |
| **No auto-PR for UI work** | Push branch only. Let user verify visually before creating a PR. |
| **Fun fact in PR body** | Every PR body MUST include a fun fact. |
| **No Co-Authored-By** | Never add Co-Authored-By or AI attribution to commits or PRs. |

---

## Additional Context Tiers

Load these ONLY when your command needs them:

| Tier | File | When to load |
|------|------|-------------|
| **Crew** | `_shared-crew.md` | Commands that spawn agents (start, execute, fix, verify, review, visual, recruit, scout, eval, wrap) |
| **Contracts** | `_shared-contracts.md` | Commands that create/validate contracts or run hooks (start, execute, contract, validate, verify, fix) |
| **Board** | `_shared-board.md` | Commands that interact with board state (status, board, board-start, board-stop, board-status, start) |
| **Superpowers** | `_shared-superpowers.md` | Commands that create plans or run execution/verification/fix loops (start, execute, fix, verify) |
