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

## Enforced Workflow Rules

| Rule | Enforcement |
|------|-------------|
| **Follow repo conventions** | Read repo's CLAUDE.md and `.claude/rules/` for coding conventions. Never assume a specific UI framework or tech stack. |
| **Use task events for state** | Just use `TaskCreate`/`TaskUpdate` with `[CrewName]` prefixes. Event log is the source of truth. |
| **bypassPermissions for all agents** | All spawned agents use `mode: "bypassPermissions"`. Never ask for approval to spawn. |
| **Smart PR strategy** | If changed files touch UI layer (detected via `_shared-repo-detection.md`), push branch only for visual verification. If no UI touched or repo has no UI layer, create a draft PR. Never auto-create a ready-for-review PR. |
| **Fun fact in PR body** | Every PR body MUST include a fun fact. |
| **No Co-Authored-By** | Never add Co-Authored-By or AI attribution to commits or PRs. |
| **Codebase-first exploration** | Read repo's CLAUDE.md, AGENTS.md, and `.claude/rules/` before exploring code. Use available graph/search tools if present, fall back to Grep/Glob/Read. |
| **Caveman-compress learnings** | All prose files in `learnings/`, `decisions/`, and session markdown MUST be kept in caveman-compressed format. Run `cd ~/.claude/plugins/marketplaces/caveman/compress && python3 -m scripts <filepath>` on any prose file before it grows past ~80 lines. Originals backed up as `.original.md`. Saves ~45% input tokens per session. |
| **Caveman output mode** | ALL agents (including Cortex) MUST output in caveman-full mode. Drop articles/filler/hedging, fragments OK, short synonyms. Technical terms exact. Code blocks unchanged. Pattern: `[thing] [action] [reason]`. Exception: security warnings, irreversible confirmations, and user-facing PR/commit text use normal English. Saves ~65% output tokens. |
| **Cache-friendly prompts** | Static content first, dynamic last in all agent prompts. Never switch models mid-session (caches are model-specific) — use subagents for different models instead. Saves ~90% on cached input tokens. |
| **Lifecycle tags on learnings** | Every INDEX.md entry MUST include lifecycle tag: `[proposed]` (untested), `[validated:N]` (confirmed N times), `[failed]` (tried, abandoned). Cortex prioritizes `[validated:5+]` as high-confidence, flags `[proposed]` for validation, deprioritizes `[failed]`. |
| **Anti-repetition gate** | Before proposing any approach (Phase B planning, Spark implementation), scan `learnings/INDEX.md` corrections for entries matching proposed approach. If match found: acknowledge it, explain why this time is different, or choose alternative. Falls back to `global/patterns/INDEX.md` as secondary check. |
| **Scoped knowledge** | All learnings, decisions, edges are repo-scoped under `repos/{REPO_NAME}/`. Cross-project patterns require explicit promotion via `[scope:global]` tag during `/team:wrap`. Global entries are read-only copies with `derived_from: {REPO}` provenance. |

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
