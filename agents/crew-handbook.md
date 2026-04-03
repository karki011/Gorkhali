# Straw Hat Crew Handbook

Reference material for Luffy. Read sections on-demand when executing specific commands.

## Scout Missions (Phase B — Background Research)

During planning, when you identify knowledge gaps, spawn research scouts in the background.
The main conversation CONTINUES with the user while scouts gather intel.

### When to Scout

| Knowledge Gap | Scout Agent | Model | What They Do |
|---|---|---|---|
| Need BE API schema/types | Jinbe (or general-purpose) | `sonnet` | Read BE repo/API docs, extract contracts, return TypeScript types |
| Need to understand existing FE patterns | Franky | `sonnet` | Explore codebase for reusable hooks/components, return inventory |
| Need design specs from Figma | Usopp | `sonnet` | Extract specs via Figma MCP, return component specs |
| Need to check legacy code | Sabo | `sonnet` | Survey legacy codebase for migration scope |
| Need to check if feature exists elsewhere | Any crew | `sonnet` | Search codebase for similar implementations |

### How to Scout

1. **Identify the gap** during Phase B planning conversation
2. **Spawn scout** with `run_in_background: true` and a descriptive `name` (e.g., "jinbe-scout")
3. **Continue planning** with the user — don't block on scout results
4. **When scout returns**, incorporate findings into the plan
5. If plan is finalized before scout returns, **wait for scout data** before finalizing API contracts

### FE ↔ BE Coordination Pattern

For cross-stack features:
1. Spawn Jinbe to read the BE codebase (provide repo path or API docs URL)
2. Jinbe returns: endpoint shapes, response types, error codes, auth requirements
3. Luffy creates a `contracts/api/` file with aligned FE types
4. Sanji implements the hooks matching the discovered BE contract
5. Franky designs the data flow from API → domain → UI

### Scout Rules
- Scouts ALWAYS use `run_in_background: true`
- Scouts ALWAYS have a descriptive `name` for tracking
- Scouts return structured data (types, schemas, file inventories) — not prose
- If a scout fails or times out, fall back to asking the user

## Directory Structure

```
~/.claude/team/repos/{REPO_NAME}/
├── state/
│   ├── current.json              # Pointer: { "activeTicket": "CP-XXXXX" }
│   ├── sessions/                 # One JSON per active session
│   │   ├── CP-39209.json
│   │   └── CP-39332.json
│   └── completed/                # Archived completed sessions
├── archive/
│   └── index.md                  # Quick-scan table of all completed work
├── decisions/
│   ├── index.md                  # Quick-scan decision table
│   └── adr/                      # Full records for complex decisions
├── sessions/
│   └── {TICKET}/                 # One folder per ticket, dated session files
├── learnings/
│   ├── INDEX.md                  # Always loaded — one-liner quick reference
│   ├── ui.md                     # Chakra, components, tokens (## Patterns / ## Corrections / ## Habits)
│   ├── data.md                   # Jotai, API, DSL, state management
│   ├── auth.md                   # Auth0, OIDC, SSO
│   ├── testing.md                # Vitest, CI, Playwright
│   ├── crew.md                   # Agent orchestration, board, Greptile
│   ├── migration.md              # Codebase migrations, feature flags
│   └── tooling.md                # Figma, AG Grid, misc
├── story/
│   ├── index.md                  # Series table of contents (Straw Hat Chronicles)
│   └── chapter-{NNN}.md          # Connected anime-style narrative chapters
└── board-app/                    # Vite + React + Hono board app (replaces server.cjs)
```

## Workflow Detection

| Signals | Workflow | Pattern |
|---|---|---|
| "build/create/add", branch `feat/` | Feature Build | Fan-out parallel |
| "fix/bug/crash", branch `fix/` | Bug Fix | Pipeline: diagnose → fix → verify |
| "review/audit/check" | Code Review | Parallel analysis → synthesized report |
| "refactor/migrate", branch `refactor/` | Refactor | Snapshot → restructure → verify |

## Decision Capture

**Quick decisions** → append one row to `decisions/index.md`:
```markdown
| D14 | Short description of decision | 2026-03-25 | Active |
```

**Complex decisions** (with rationale, trade-offs, references) → also create `decisions/adr/D14-short-name.md`:
```markdown
# D14: Short description
**Date**: 2026-03-25 | **Status**: Active
## Decision
What was chosen.
## Why
Context and rationale.
## Alternatives considered
What was rejected and why.
```

## Marines (Quality Enforcement)

Marines are the opposition that keeps the Straw Hats honest. They enforce order and quality.

| Character | Role | Agent File | When Used |
|-----------|------|------------|-----------|
| **Sengoku** ⚓ | Fleet Admiral / Quality Gate | `marines/sengoku.md` | Second-to-last task in EVERY plan (third-to-last if Smoker runs) |
| **Smoker** 🌫️ | Visual Inspector | `marines/smoker.md` | After Sengoku, before User Feedback — UI tasks only |

### Sengoku's Enhanced Gauntlet (v2.2 — always runs before User Feedback)
1. `git add .` — baseline current changes
2. **Parallel scan** — spawn BOTH in parallel (`run_in_background: true`):
   - `pr-review-toolkit:code-simplifier` on changed files
   - `pr-review-toolkit:silent-failure-hunter` on changed files (catches silent failures, broad catches, swallowed errors)
3. Report silent-failure-hunter findings (CRITICAL must fix, WARNING for awareness)
4. `git diff` — show what simplifier changed
5. Spawn Roger to review ONLY the simplifier diff → APPROVE (keep) or REJECT (revert)
6. Full verify: `pnpm check` + `pnpm build` + affected tests
7. Report verdict: CLEARED FOR USER TESTING / BLOCKED

### Phase Task Order (ALWAYS)
```
... implementation tasks ...
→ Roger 👑 triple-lens review (Roger + feature-dev:code-reviewer + git-history + conditional type-design-analyzer)
→ Chopper 🩺 verifies build
→ Sengoku ⚓ enhanced gauntlet (simplify + silent-failure-hunter + Roger review + final verify)
→ Smoker 🌫️ visual inspection loop (UI tasks only — skip for API/config/test-only tasks)
→ User Feedback 🍊 (ALWAYS last, standalone task)
```

### Auto-Continue Between Phases (30s Timeout)
After completing each phase, Luffy posts a brief phase summary and waits **30 seconds** for user feedback. If the user does not reply within 30s, Luffy automatically proceeds to the next phase. This keeps execution flowing without blocking on every phase transition — the final "User Feedback" task is the dedicated checkpoint where the user reviews and tests everything.

## Verify → Fix Loop (v2.1)

After Phase C execution completes, verification is multi-layered with a built-in repair cycle.

### Verification Phase

1. **Zoro** — tests against locked contracts
2. **Chopper** — `pnpm check` + `pnpm build` + affected tests
3. **Roger** — quality gate review (if risk >= medium)

### Post-Verify Routing

Verification results are tracked via TaskUpdate — the board-sync hook captures the status automatically.

- **PASS** → proceed to Sengoku gauntlet or wrap
- **FAIL** → enter fix sub-loop (see below)

### Fix Sub-Loop

1. Track loop count internally (max 3)
2. Spawn **Kureha** (model: sonnet, from `allies/kureha.md`) to triage failures and create fix packet
3. Show fix packet to user for approval
4. Assign scoped repairs — only failing scope, no new features
5. Spawn repair agents (only assigned owners)
6. After repairs → re-run Chopper verification
7. If pass → exit loop
8. If fail → repeat from step 1

### Loop Stop Conditions

- **Max 3 loops** → escalate to user (something systemic)
- **Same failure twice** → write correction to relevant `learnings/{domain}.md` under `## Corrections` + escalate
- **Contract must change** → return to contract phase
- **Scope expansion** → return to planning

### Commands

- `/team:verify` — explicitly trigger verification phase
- `/team:fix` — start fix loop from latest failed verification (blocks if no failures recorded)

## Visual Verify → Fix Loop (Smoker)

After Sengoku clears the code quality gauntlet, Smoker runs visual inspection for **UI tasks only**.
Uses Playwright MCP tools (CLI-based, no headed browser needed) to navigate, screenshot, and verify.

### When to Include Smoker

| Task Type | Include Smoker? |
|-----------|----------------|
| UI components, pages, layouts | **YES** |
| Figma implementation | **YES** |
| Style/theme changes | **YES** |
| API-only, domain logic | No |
| Tests, docs, config | No |
| Refactor with no visual change | No |

Luffy decides at planning time and includes Smoker in the plan with target routes.

### Visual Inspection Flow

1. **Smoker** navigates to target routes via `browser_navigate` → `http://localhost:8080/{route}`
2. Takes screenshots with `browser_take_screenshot` — evidence for every route/state
3. Tests interactions: clicks, form fills, tab switches — screenshots after each
4. Analyzes screenshots (multimodal) against task requirements
5. Produces visual inspection report with PASS/FAIL per route

### Visual Fix Sub-Loop

When Smoker finds issues:

1. Smoker creates a **visual fix packet** (route, element, issue, severity, suggested fix)
2. Luffy assigns fixes — Nami for layout/styling, Franky for state/data-driven visual bugs
3. Fix agents make repairs (scoped to visual issues only)
4. **Chopper quick-verify** — `pnpm check` + `pnpm build` to ensure fixes don't break build
5. **Smoker re-inspects** the same routes
6. Loop until visual PASS or max 3 loops

### Loop Stop Conditions

- **PASS** → proceed to User Feedback
- **Max 3 loops** → escalate to user with screenshots of remaining issues
- **Same issue twice** → write correction to relevant `learnings/{domain}.md` under `## Corrections` + escalate
- **Design ambiguity** → escalate with screenshot + question for user

### Commands

- `/team:visual` — explicitly trigger Smoker's visual inspection on current task
- `/team:visual /route1 /route2` — inspect specific routes

## Validation Scripts (`~/.claude/team/scripts/`)

Luffy runs these at specific checkpoints during execution.

| Script | When to Run | What it Checks |
|--------|-------------|----------------|
| `validate-plan.sh <session.json>` | Before Phase C execution | Phase order, Smoker inclusion, file ownership, assignees |
| `validate-output.sh <agent> <files>` | After each agent completes | File ownership, copyright, tokens, barrel exports |
| `validate-session.sh <session.json>` | At phase transitions, after verify | JSON structure, status enums, verification blocks, loop counts |

**PreToolUse hook** (`~/.claude/hooks/validate-agent-spawn.sh`) runs automatically on every Agent tool call — validates `bypassPermissions`, `run_in_background`, model tier, and prompt content. BLOCKs bad spawns.

### Automatic Validation Flow
```
Plan approved → validate-plan.sh → PASS? → start execution
  Each agent completes → validate-output.sh → log warnings
  Phase transitions → validate-session.sh → check state integrity
  Verify phase done → validate-session.sh → confirm verification block
  All done → /team:validate all → final check before user feedback
```

## /team:pause — Smart Pause with Context Clear

When the user runs `/team:pause`:
1. `TaskCreate({ subject: "[Luffy] SESSION:pause" })` — the board-sync hook pauses the session
2. Write brief checkpoint notes to session file in `sessions/{TICKET}/`
3. After saving, run `/clear` to free Claude's context window
4. All state is persisted in team files — `/team:resume` restores everything

This gives the user a clean context on their next message while nothing is lost.

## Session Commands

- `/team:pause` → Smart save: SESSION:pause task → write checkpoint → clear context
- `/team:wrap` → Full shutdown + archive (see wrap section below)
- `/team:status` → Task board from `state/sessions/{TICKET}.json`
- `/team:sessions` → List ticket folders in `sessions/`
- `/team:learn "<correction>"` → Categorize by domain, append to `learnings/{domain}.md` under `## Patterns` / `## Corrections` / `## Habits`, update `learnings/INDEX.md`
- `/team:board` → Start board app at http://localhost:3848 (Hono API + Vite React app)
- `/team history` → Show archive of completed work from `archive/index.md`
- `/team story` → Read the latest chapter or full chronicle from `story/`

## /team:wrap — Full Shutdown + Archive

When the user runs `/team:wrap`, execute these steps in order:

### 1. Capture Knowledge
- Write final session file to `sessions/{TICKET}/`
- Update `decisions/index.md` with any new decisions
- Update relevant `learnings/{domain}.md` files — patterns (what worked), corrections (what went wrong), habits (confirmed preferences)
- Update `learnings/INDEX.md` with one-liners for new entries
- Update auto-memory

### 2. Archive Completed State
- `TaskCreate({ subject: "[Luffy] SESSION:wrap" })` — the board-sync hook archives the session and builds completion metadata automatically

### 3. Update Archive Index
- Append a row to `archive/index.md`:
  ```markdown
  | CP-39187 | Cutting Board Wizard POC | 2026-03-24 | 2026-03-25 | 3/6 phases | Franky, Nami, Sanji, Chopper | sessions/CP-39187/ |
  ```
- Create `archive/index.md` if it doesn't exist, with this header:
  ```markdown
  # Completed Work Archive

  | Ticket | Title | Started | Completed | Progress | Crew | Session Files |
  |--------|-------|---------|-----------|----------|------|---------------|
  ```

### 4. Clean Up
- The board-sync hook handles session cleanup and archival automatically via the SESSION:wrap command
- The archived state lives forever in `state/completed/{TICKET}.json`

### 5. Write Story Chapter (Straw Hat Chronicles)
Spawn **Robin** to write the next chapter of the ongoing anime-style chronicle.
**IMPORTANT:** Use `mode: "bypassPermissions"` when spawning Robin — the story directory is outside the project working directory and Write will be denied without it.

Robin's prompt should include:
- The ticket, title, and crew who participated
- A summary of what was built (from session file + archived state)
- Key decisions made (from decisions/index.md)
- What went wrong (from `## Corrections` in relevant `learnings/{domain}.md` files — plot tension)
- What patterns/breakthroughs happened (from `## Patterns` in relevant `learnings/{domain}.md` files — victories)
- Whether any Grand Fleet allies were recruited

Robin reads:
- `story/index.md` — to determine the chapter number
- Last `story/chapter-{N-1}.md` — reads "The Horizon" section for continuity with previous chapter
- Session data above for the current episode's events

Robin writes:
- `story/chapter-{N}.md` — the new chapter with connected narrative
- Updates `story/index.md` — appends a new row

Create `story/` directory if it doesn't exist.

## Marketplace Plugin Integration Map

The Straw Hat system integrates with official marketplace plugins. This is the source of truth for which plugins are used where.

### Plugins Consumed by Crew Members

| Plugin | Used By | How |
|---|---|---|
| `pr-review-toolkit:code-simplifier` | Sengoku (Step 2a) | Parallel polish pass in quality gauntlet |
| `pr-review-toolkit:silent-failure-hunter` | Sengoku (Step 2b) | Parallel error handling audit in quality gauntlet |
| `pr-review-toolkit:type-design-analyzer` | Roger (conditional) | Type design quality check when new types in diff |
| `pr-review-toolkit:comment-analyzer` | Robin (post-docs) | Verifies comment accuracy after documentation work |
| `feature-dev:code-reviewer` | Roger (triple-lens #2) | Generic bug/security/quality review alongside Roger |
| `feature-dev:code-architect` | Luffy (Phase B step 7) | Multi-approach architecture for features with 3+ new files |
| `context7` | Nami, Franky, Sanji, Zoro | Live library docs lookup (React, TanStack, Vitest, MSW, etc.) |
| `playwright` | Smoker | Visual inspection via Playwright MCP tools |
| `figma` | Usopp | Design spec extraction via Figma MCP |
| `atlassian` | Luffy (Phase A) | Jira ticket lookup and status transitions |
| `greptile` | Roger (via /greptile-fix) | PR review comment resolution |
| `commit-commands` | Luffy (/team:wrap) | Git commit + PR creation |
| `code-review` | Roger (triple-lens #3) | Git-blame analysis + prior-PR-comments (historical lens) |

### ai-sdlc Dedup: What to Use From Each System

The `ai-sdlc` plugin has workflow overlap with Straw Hat. **Straw Hat is the primary workflow.** Use these ai-sdlc skills as standalone supplements:

| ai-sdlc Skill | Use When | Why Not Straw Hat? |
|---|---|---|
| `/ai-sdlc:pre-commit` | Quick quality check before commit (no full gauntlet needed) | Lighter than Sengoku — just lint+type+test+format |
| `/ai-sdlc:rfr` | Generate Ready for Review Confluence doc for an Epic | Straw Hat doesn't generate Confluence RFR docs |
| `/ai-sdlc:drift-check` | Detect drift between PLAN.md, git, Jira, filesystem | Unique capability — catches out-of-band changes |
| `/ai-sdlc:audit` | Comprehensive code audit (architecture, maintainability) | Supplements Roger — broader scope than KISS/DRY review |
| `/ai-sdlc:proofread` | Proofread markdown documents | Robin writes stories, not proofreads |

**Do NOT use** (redundant with Straw Hat):
- `/ai-sdlc:new-session` → use `/team:start`
- `/ai-sdlc:save-session` → use `/team:pause`
- `/ai-sdlc:resume-session` → use `/team:resume`
- `/ai-sdlc:checkpoint` → use `/team:wrap` or manual commit
- `/ai-sdlc:create-pr` → use `/commit-commands:commit-push-pr`

## Project Learnings

Before starting work, check if this project has team learnings:
- `~/.claude/team/repos/{REPO_NAME}/learnings/INDEX.md` — quick reference (always read)
- `~/.claude/team/repos/{REPO_NAME}/learnings/{domain}.md` — domain-specific learnings (each has ## Patterns / ## Corrections / ## Habits)
- Domains: `ui.md`, `data.md`, `auth.md`, `testing.md`, `crew.md`, `migration.md`, `tooling.md`

Where `{REPO_NAME}` is the git repo name. Load INDEX.md always, then domain files matching your task.

### Obsidian Vault (User's Second Brain)

The user maintains an Obsidian vault at `/Users/subash.karki/Documents/sk/`. The `Straw Hat Team/` folder inside it is a symlink back to `~/.claude/team/repos/` — do NOT write to it separately.

However, the user may add their own notes elsewhere in the vault (meeting notes, architecture ideas, tech spikes). When researching or needing cross-project context, agents can search this vault:
- `grep` or `glob` across `/Users/subash.karki/Documents/sk/` for user-curated knowledge
- Skip `.obsidian/` (config directory) and `Straw Hat Team/` (already covered by team repos)
