# Team Skill Crew -- Shared Context (Core)

> **Every `/team:*` subcommand MUST load this file first.**
> Additional context tiers are loaded only by commands that need them.

---

## Governance Layer

1. Read `AGENTS.md` from the repo root (or nearest ancestor)
2. Read `.claude/rules/` for repo-wide conventions
3. Core Principles: Load coding principles in this order (first found wins):
   a. Repo's `.claude/rules/coding-principles.md` (repo-specific, highest priority)
   b. `~/.claude/team/reference/coding-principles.md` (bundled with team skill, fallback)
   c. If neither exists: apply defaults — **KISS**, **DRY**, **YAGNI**, **SOLID**, **SoC**

---

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

---

## Iron Laws

| # | Law | Enforcement |
|---|-----|-------------|
| 1 | **Feature branch** | Before commit: `git branch --show-current`. On `main`/`develop`/`master` → create `{TICKET}/{slug}` branch. |
| 2 | **Verification mandatory** | After implementation: Sentinel runs repo commands. Read full output. Confirm pass. Then claim "done". |
| 3 | **Anti-repetition** | Before approach: scan `learnings/INDEX.md`. `[failed]` → blocked (explain difference or choose alternative). `[validated:5+]` → auto-apply. |
| 4 | **Devil's Advocate** | Every plan challenged before execution. Verdict: PROCEED/REVISE/RETHINK. Max 2 iterations. |
| 5 | **Simplify always runs** | After verification pass: `simplify` on changed files. If changes → re-verify. |
| 6 | **Intent check** | After Sentinel PASS: review diff against contract intent. Tests passing ≠ problem solved. ALIGNED/DRIFT/WRONG. |
| 7 | **Smart PR** | UI touched → push branch only (user verifies visually). No UI → draft PR. Never auto-create ready-for-review PR. |
| 8 | **Jira auto-transition** | After push/PR: transition ticket to "Reviewing" + comment with link. |
| 9 | **Learnings** | Every session reads and writes learnings. After wrap: record successes, corrections, validate/promote patterns. |
| 10 | **Auto-CREW trigger** | If any: 4+ files across 2+ packages, API + tests, security changes, schema + app code, cross-layer, perf-critical → route CREW. Checklist only. |
| 11 | **Root cause or nothing** | Reproduce → trace → identify root cause → explain to user → get confirmation → fix. Cannot explain WHY = cannot write fix. Same failure twice → discard approach, re-plan. |
| 12 | **Parallel agents** | 2+ independent files → spawn parallel agents. Never edit sequentially when parallelizable. |
| 13 | **Subagent-driven always** | All implementation through Agent tool. Cortex tools: Read, Bash (git only), TaskCreate, Skill, Agent. Even 1-line fixes → spawn agent. Call `Skill("superpowers:subagent-driven-development")` before dispatch. |

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

---

## Additional Rules (important but not iron laws)

| Rule | Enforcement |
|------|-------------|
| **Use task events for state** | Use `TaskCreate`/`TaskUpdate` with `[CrewName]` prefixes. Event log is source of truth. |
| **No Co-Authored-By** | Never add Co-Authored-By or AI attribution to commits or PRs. |
| **Lifecycle tags on learnings** | Every INDEX.md entry MUST include lifecycle tag: `[proposed]`, `[validated:N]`, or `[failed]`. |
| **Scoped knowledge** | All learnings repo-scoped under `repos/{REPO_NAME}/`. Cross-project promotion via `[scope:global]` during wrap. |
| **Cache-friendly prompts** | Static content first, dynamic last. Use subagents for different models — never switch mid-session. |

---

## Output Style

All agents: terse, technical-exact, no filler. Expand for security warnings or user confusion.

---

## Smart Learnings Loading

Instead of loading all domain learnings files every session, load based on task classification:

### Loading Strategy

```
# Always loaded (lightweight, one-liners):
ALWAYS: learnings/INDEX.md, learnings/EDGES.md (on demand)

# Load based on task domain (from Phase A classification):
IF task touches UI components/styles/layouts:
  LOAD: learnings/ui.md
IF task touches API calls/data fetching/state management:
  LOAD: learnings/data.md
IF task touches auth/sessions/permissions:
  LOAD: learnings/auth.md
IF task touches test files or verification:
  LOAD: learnings/testing.md
IF task touches build/CI/tooling config:
  LOAD: learnings/tooling.md
IF task touches schema/data migration:
  LOAD: learnings/migration.md
IF task is crew/workflow related:
  LOAD: learnings/crew.md

# Cross-cutting: load if task risk >= medium
IF risk >= medium:
  LOAD: ALL domain files (comprehensive context needed)
```

### Domain Detection Heuristic

| Signal | Domain |
|---|---|
| Files: `*.tsx`, `*.css`, `components/`, `styles/` | ui |
| Files: `*.api.*`, `hooks/use*`, `services/`, `graphql/` | data |
| Files: `auth/`, `session/`, `permissions/`, `middleware/` | auth |
| Files: `*.test.*`, `*.spec.*`, `__tests__/`, `cypress/` | testing |
| Files: `*.config.*`, `Makefile`, `.github/`, `tsconfig.*` | tooling |
| Files: `migrations/`, `schema/`, `*.sql` | migration |
| Keyword: "crew", "agent", "workflow", "skill" | crew |

Multiple domains can match — load all matching. When in doubt, load more rather than less. The cost of loading an extra 50-line file is far less than missing a critical correction.

---

## Additional Context Tiers

Load these ONLY when your command needs them:

| Tier | File | When to load |
|------|------|-------------|
| **Crew** | `_shared-crew.md` | Commands that spawn agents (start, execute, fix, verify, review, visual, recruit, scout, eval, wrap) |
| **Contracts** | `_shared-contracts.md` | Commands that create/validate contracts or run hooks (start, execute, contract, validate, verify, fix) |
| **Event Log** | `_shared-board.md` | Commands that interact with session state (start, execute, wrap, status) |
| **Superpowers** | `_shared-superpowers.md` | Commands that create plans or run execution/verification/fix loops (start, execute, fix, verify) |
| **Repo Detection** | `_shared-repo-detection.md` | Commands that run verification or create PRs (start, execute, fix, verify, wrap) |
| **Phantom AI** | `_shared-phantom-integration.md` | Commands that benefit from graph intelligence (start, execute, fix). OPTIONAL — degrades gracefully if phantom-ai MCP not available. |
| **Auto-Learning** | `_shared-auto-learning.md` | Commands that complete work (start, execute, fix, verify, wrap). MANDATORY — every session both reads AND writes learnings. |
