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

<phase_a_context>

## Phase A: Context

1. Parse TICKET from $ARGUMENTS or `git branch --show-current`
2. Create `state/sessions/{TICKET}/` directory
3. Check for existing artifacts -- if found, ask: resume or fresh?
4. If Jira MCP available: fetch ticket, extract acceptance criteria
5. Load `learnings/INDEX.md`, scan for relevant corrections
6. If Phantom MCP available: call `phantom_before_edit` for blast radius (non-blocking)
7. Write `state/sessions/{TICKET}/context.json` with `_meta` header
8. Activate apex hook: `touch ~/.claude/team/.apex-active`
9. **Hound check** -- classify input as bug vs feature (see below)

</phase_a_context>

<detective_pre_scan>

## Phase A.5: Hound Pre-Scan (bugs only)

Trigger: keywords (`bug`, `broken`, `regression`, `error`, `crash`, `failing`, `TypeError`),
Jira type (Bug/Defect/Incident), or branch prefix (`fix/`, `bugfix/`, `hotfix/`).

If bug → hotspot + ownership check on suspect files, add `hound` field to context.json.
See `reference/hound-protocol.md` for full protocol. Skip silently for features.

</detective_pre_scan>

<phase_b_classify_route>

## Phase B: Classify + Route

READ `reference/router.md` for full classification algorithm, signal definitions, and route specs.

### B.1 Gather Signals (parallel, <5s)

Parallel: blast radius (1 MCP), competing patterns (1 MCP), domain novelty + routing history (2 file reads), ambiguity markers + AC (free string matching).

### B.2 Classify

Run algorithm from `reference/router.md`: hard overrides → uncertainty score → scope score → learnings correction → route selection.

### B.3 Write Route Decision

Write `state/sessions/{TICKET}/route-decision.json` (schema in router.md).
Report to human: `"[{ROUTE}] {rationale} — {expected files}"`

### B.4 Branch to route below.

</phase_b_classify_route>

<route_direct>

## Route: DIRECT (0 human gates)

READ `reference/router.md` SS DIRECT for guardrails.

1. Write minimal `intent.json` (goal + done-when from Jira AC or description)
2. Spawn Blade agent with task — no planning, no deliberation
3. `Skill(skill="phantom:verify")` — writes verification.json
4. If PASS → `Skill(skill="phantom:wrap")`
5. If FAIL → **auto-escalate to PLAN route** (do NOT retry as DIRECT)
6. If >3 files changed → log routing correction to `learnings/shadows.md`

</route_direct>

<route_plan>

## Route: PLAN (1 human gate)

READ `reference/router.md` SS PLAN + SS Deliberation Protocol. READ `reference/planning.md`.

1. Capture Intent → write `intent.json`
2. Codebase research (Explore + Plan agents, opus) + anti-repetition scan
3. Produce plan (SOLO/CREW routing per `reference/agents.md`)
4. **Deliberation**: Planner ↔ Challenger, max 2 rounds (router.md)
5. Present: consensus → "OK to proceed?" / disagreement → human breaks tie
6. Write `plan.json` with deliberation verdict
7. **HUMAN GATE**: user approves plan
8. Contracts (`reference/contracts.md`)
9. If plan touches >5 files → `Skill(skill="phantom:wire")` for topology (informational, no human gate on PLAN route). Otherwise auto-generate lightweight wiring.
10. Execute: dispatch agents per plan → verify → wrap (or fix loop)

</route_plan>

<route_brainstorm>

## Route: BRAINSTORM (2 human gates)

1. `Skill(skill="phantom:brainstorm")` — diverge/converge, writes `decisions.json` + updates `intent.json`
2. **HUMAN GATE 1**: handled inside brainstorm skill (human picks direction)
3. Feed locked decision into PLAN route as scope anchor (steps 1-9 above)
4. **HUMAN GATE 2**: approve plan

</route_brainstorm>

<route_full>

## Route: FULL (3 human gates)

1. `Skill(skill="phantom:brainstorm")` — diverge/converge, writes `decisions.json` + updates `intent.json`
2. **HUMAN GATE 1**: handled inside brainstorm skill (human picks direction)
3. **Plan**: Intent → Research → Decompose → Deliberate (same as PLAN route)
4. **HUMAN GATE 2**: approve plan
5. `Skill(skill="phantom:wire")` — dependency topology, wave assignments, integration points, risk points
6. **HUMAN GATE 3**: approve wiring (presented by wire skill)
7. Execute in waves per wiring.json → verify → wrap (or fix loop)

</route_full>

<context_management>

## Context Management

Between any phase: if context is heavy, run `Skill(skill="phantom:pause")`.
User runs `/clear` then `/phantom:resume {TICKET}` to continue from the last artifact.
Resume reads `route-decision.json` to know which flow to continue.

</context_management>
