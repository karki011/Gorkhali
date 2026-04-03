---
name: team:start
description: Plan -> contracts -> approve -> execute a new task
argument-hint: "<requirement>"
---

> Load `_shared.md` + `_shared-crew.md` + `_shared-contracts.md` + `_shared-board.md` + `_shared-superpowers.md` before executing.

# /team:start "$ARGUMENTS"

## Phase A -- Context Loading

1. Detect ticket from git branch, load `decisions/global.md` (cross-cutting only)
2. Load `learnings/INDEX.md` (always) + `learnings/crew.md` (always relevant for orchestration)
   - After task classification, load domain-specific learnings:
     - UI task → `learnings/ui.md`
     - Data/state/API → `learnings/data.md`
     - Auth/SSO → `learnings/auth.md`
     - Tests/CI → `learnings/testing.md`
     - Migration/refactor → `learnings/migration.md`
     - Tooling/AG Grid/Figma → `learnings/tooling.md`
3. Create dirs: `sessions/{TICKET}/contracts/` (for contracts/decisions — human-readable)
4. Detect workflow type (feature, bug, refactor, spike, docs)
5. Check if `sessions/{TICKET}/decisions.md` exists from prior work -- if so, load it too
6. **Start board server if not running:**
   - Check ports 3847 and 3848: `lsof -ti:3847` and `lsof -ti:3848`
   - If BOTH are already listening -> skip (server is running)
   - If NOT running -> start: `cd ~/.claude/team/board-app && pnpm dev:all &`
   - Do NOT fail or block if the server can't start -- this is best-effort
7. **The board-sync hook auto-creates session state** when the first TaskCreate fires. No manual JSON needed. Just create your tasks with `[CrewName]` prefixes and the hook builds the board automatically.
8. **Create TaskCreate entries for every task** with `[CrewName]` prefix — board-sync hook auto-builds crew roster and board state
9. **Run Pre-Plan Hook:**
   - Classify task type and risk level
   - Detect missing context (design? API? migration?)
   - Decide if scouts are needed -> if yes, offer to run them
   - Determine if Roger is a hard gate

## Phase B -- Planning (NO crew spawned)

> **IMPORTANT: Enter plan mode at the start of Phase B using `EnterPlanMode`.** Stay in plan mode for the entire planning phase. Only exit (`ExitPlanMode`) once the plan is finalized and user-approved.

> **MODEL: All research agents, scout agents, and the Plan agent in this phase MUST use `model: "opus"`** — this ensures deep codebase analysis and catches edge cases before implementation begins. Implementation agents (Nami, Zoro, Chopper, etc.) can use the default Sonnet model.

1. Ask questions, iterate, confirm understanding
2. **CODEBASE FIRST** inventory -- read existing patterns before proposing new ones
   - Spawn Explore agent(s) with `model: "opus"` for codebase research
   - Spawn Plan agent with `model: "opus"` to design the implementation approach
   - **Planning discipline** (`superpowers:writing-plans`): Plan MUST include File Structure (exact paths) before tasks,
     bite-sized tasks (one action, 2-5 min each), no placeholders (TBD/TODO/"similar to Task N"), self-review after writing
   - For complex features (risk >= medium): apply `superpowers:brainstorming` -- propose 2-3 approaches with tradeoffs before settling
3. Produce plan with:
   - Selected crew and agent-to-task mapping
   - Required contracts (which types, who owns each section)
   - Execution order with dependencies
   - Risks and open questions
4. Get user approval via `ExitPlanMode`

## State Checkpointing

Before each phase transition, snapshot session state for rollback:
- After Phase B: `state/sessions/{TICKET}/snapshots/phase-b-complete.json`
- After Phase C: `state/sessions/{TICKET}/snapshots/phase-c-complete.json`
- After each verify loop: `state/sessions/{TICKET}/snapshots/phase-d-loop-{N}.json`

To rollback: copy snapshot back to main session JSON. Board-sync hook auto-detects restored state.

## Phase C -- Contract Phase

1. For each required contract type, create from template:
   - Fill metadata, goal, inputs/outputs, ownership, acceptance criteria
   - Store in `sessions/{TICKET}/contracts/` AND optionally in `.claude/contracts/`
2. **Run Pre-Execute Hook** -- block if contracts are incomplete or interfaces undefined
3. Show contract summary to user, get final "Execute now" confirmation

## Phase D -- Execution + Verify + Fix

1. Spawn crew with: personas from `.claude/agents/`, assigned contracts, skills, learnings
   - **Dispatch discipline** (`superpowers:dispatching-parallel-agents`): One agent per domain, `isolation: "worktree"` for parallel file-modifying agents, focused self-contained prompts, verify integration after all return
2. Run agents per execution order (parallel where independent, sequential where dependent)
3. **After each agent: run Post-Agent Hook** -- validate output, capture handoff, check unblocked
4. When all build agents done -> spawn Zoro for tests against contracts
5. Spawn Chopper for verification (lint, typecheck, build, tests)
6. **Run Post-Verify Hook** -- verification results tracked via TaskUpdate automatically
7. **If PASS** -> proceed to step 9
8. **If FAIL** -> enter fix sub-loop:
   a. Track loop count internally (max 3)
   b. Spawn **Kureha** (model: sonnet, persona from `.claude/agents/kureha.md`) to triage failures and create fix packet
   c. Luffy assigns scoped repairs from Kureha's diagnosis -- only the failing scope, no new features
   d. Spawn repair agents (only assigned owners, only failing files)
   e. After repairs -> re-run Chopper verification
   f. If pass -> exit loop, proceed to step 9
   g. If fail -> repeat from step 8a (max 3 loops, then escalate to user)
   h. **Same failure twice** -> write correction to relevant `learnings/{domain}.md` under `## Corrections` + escalate
   i. **Contract must change** -> return to Phase C (contract lock)
   j. **Scope expansion** -> return to Phase B (planning)
9. If risk >= medium -> spawn Sengoku (simplify -> Roger review -> verify)
10. If risk = low -> spawn Roger for advisory review
