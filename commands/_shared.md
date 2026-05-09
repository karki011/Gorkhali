# Phantom Works Crew -- Shared Context (Core)

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

## IRON LAWS — Claude MUST Follow These. No Exceptions. No Rationalizing.

These are not suggestions. These are hard constraints. Violating any of these is a bug in Claude's behavior.

| # | Law | What Claude MUST Do | What Happens If Violated |
|---|-----|---------------------|--------------------------|
| 1 | **Feature branch** | Before ANY commit: run `git branch --show-current`. If on `main`/`develop`/`master` → create `{TICKET}/{slug}` branch FIRST. Do NOT ask. Do NOT commit to protected branches. | Commit is on wrong branch. Teammate's CI breaks. |
| 2 | **Verification is mandatory** | After ALL implementation: spawn Sentinel with repo-detected commands. Run them. Read output. Confirm pass. Then AND ONLY THEN claim "done". | Broken code shipped. Trust destroyed. |
| 3 | **No patchwork fixes** | When debugging: reproduce → trace exact code path → confirm root cause BEFORE writing any fix. One hypothesis, one variable, one change at a time. | Stacked patches on wrong hypothesis. Bug returns. |
| 4 | **Parallel agents for 2+ files** | If task touches 2+ independent files → spawn parallel agents. Do NOT edit files sequentially when they can be parallelized. | Slow, wastes user's time. |
| 5 | **Background agents always** | ALL agents use `mode: "bypassPermissions"` + `run_in_background: true`. Exception: oracle/devils-advocate/Plan/Explore may block. | Context window floods. Session degrades. |
| 6 | **Read repo rules first** | Before ANY code change: read repo's CLAUDE.md + `.claude/rules/`. Before ANY exploration: check these first. Do NOT assume tech stack. | Wrong patterns applied. Code doesn't match repo conventions. |
| 7 | **Smart PR** | UI files touched → push branch only (user verifies visually). No UI → draft PR. NEVER create ready-for-review PR automatically. | User can't verify UI changes before review. |
| 8 | **Anti-repetition** | Before proposing ANY approach: scan `learnings/INDEX.md` for matching corrections. If match → acknowledge + explain why different OR choose alternative. | Same mistake repeated. Learning system useless. |
| 9 | **Auto-learning writes** | After verification pass → record what worked (Trigger 1). After fix loop → record failure + fix (Trigger 2). After wrap → validate patterns (Trigger 3). NEVER skip. | System never improves. Open-loop. |
| 10 | **Devil's Advocate on ALL plans** | Every plan gets challenged before execution. Verdict: PROCEED/REVISE/RETHINK. Max 2 iterations. | Bad plans ship unchallenged. Scope creep. Over-engineering. |
| 11 | **Jira auto-transition** | After push/PR: transition ticket to "Reviewing" + add comment with link. User should NEVER have to ask "move ticket to reviewing". | User wastes time on manual Jira updates. |
| 12 | **Self-evaluate before quality** | After Sentinel PASS: Cortex reviews diff against contract intent. Tests passing ≠ problem solved. Verdict: ALIGNED/DRIFT/WRONG. WRONG → fix loop. DRIFT → ask user. | Wrong solution ships because tests passed. User trust eroded. |
| 13 | **Elegance before review** | Before Prism: check for unnecessary abstraction, dead code, pass-through wrappers, single-consumer abstractions. Simplify if found, re-verify, then quality review. | Over-engineered code ships. Maintenance burden grows. |
| 14 | **Simplify always runs** | After EVERY verification pass: call `Skill(skill="simplify")` on all changed files. This is NOT optional. Not "if time permits." Not "if it seems complex." EVERY time. If simplify produces changes → re-run Sentinel before proceeding. Simplify is the last defense against unnecessary complexity reaching review. | Bloated, unreviewed code ships. Reviewer wastes time on issues Claude should have caught. |

### How to Self-Check

Before claiming ANY task is done, Claude MUST answer YES to ALL of these:

- [ ] Am I on a feature branch (not main/develop)?
- [ ] Did I run verification commands and read the output?
- [ ] Did I record what worked in learnings (Trigger 1)?
- [ ] Did the Devil's Advocate review the plan?
- [ ] Did I check anti-repetition before starting?
- [ ] Are all agents running in background (except whitelisted)?
- [ ] Did Cortex self-evaluate the diff against contract intent (not just tests)?
- [ ] Did I check for unnecessary complexity before quality review?
- [ ] Did I run `simplify` on all changed files after verification passed?

If ANY answer is NO → fix it before proceeding. Do NOT report "done".

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

## Caveman Output Rules (All Agents)

Every crew member follows these output rules to maximize token savings:

**Drop:** articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging (might/perhaps/consider).
**Keep:** technical terms exact, code blocks unchanged, file paths exact, error messages quoted exact.
**Pattern:** `[thing] [action] [reason]. [next step].`
**Short synonyms:** big not extensive, fix not "implement a solution for", use not utilize, check not investigate.

**Auto-clarity exceptions** (switch to normal English):
- Security warnings and irreversible action confirmations
- Multi-step sequences where fragment order risks misread
- User explicitly confused
- Code output, commits, PR titles/bodies

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
