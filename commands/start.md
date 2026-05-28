---
name: phantom:start
description: "Use when starting any new feature, bug fix, refactor, or task. Also use when user provides a Jira ticket (CP-*, CLOUD-*), says 'implement', 'build', 'fix', 'work on', or describes a requirement. Plans, decomposes, and executes with multi-agent shadows."
argument-hint: "<requirement>"
---

> **Preamble Tier: T4** (full orchestration -- loads ALL shared contexts)
> See `_shared.md` SS Preamble Tiers for the tier system.

# /phantom:start "$ARGUMENTS"

Adaptive router: context → classify → route(DIRECT|PLAN|BRAINSTORM|FULL) → verify.
Each phase reads/writes artifacts in `state/sessions/{TICKET}/`.
No git operations until wrap. All work is local.

## Phase A: Context

1. Parse TICKET from $ARGUMENTS or `git branch --show-current`
2. Create `state/sessions/{TICKET}/` — existing artifacts? ask resume or fresh
3. Jira MCP → fetch ticket + AC. Load `learnings/INDEX.md` for corrections.
4. Phantom MCP → `phantom_before_edit` (non-blocking). Write `context.json`.
5. Bug detected (keywords/Jira type/branch prefix) → hound pre-scan per `reference/detective/depth-levels.md`

## Phase B: Classify + Route

READ `reference/router.md` for full algorithm.

1. Gather signals (parallel, <5s): blast radius, patterns, novelty, history, ambiguity, AC
2. Classify: hard overrides → uncertainty → scope → learnings correction → route
3. Write `route-decision.json`. Report: `"[{ROUTE}] {rationale}"`

## Route: DIRECT (0 gates)

`intent.json` → Blade → verify → wrap. FAIL → escalate to PLAN. >3 files → log correction.

## Route: PLAN (1 gate)

1. Intent → research → plan (per `reference/planning.md`, `reference/agents.md`)
2. Deliberation: Planner ↔ Challenger, 2 rounds (router.md)
3. **HUMAN GATE**: approve plan
4. Contracts. >5 files → `phantom:wire`. Execute → verify → wrap.

## Route: BRAINSTORM (2 gates)

`phantom:brainstorm` → **GATE 1** (pick direction) → PLAN route → **GATE 2** (approve plan)

## Route: FULL (3 gates)

`phantom:brainstorm` → **GATE 1** → Plan → **GATE 2** → `phantom:wire` → **GATE 3** → Execute → verify → wrap

Between phases: if heavy context, `phantom:pause`. Resume reads `route-decision.json`.
