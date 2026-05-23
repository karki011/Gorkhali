---
name: team:start
description: "Use when starting any new feature, bug fix, refactor, or task. Also use when user provides a Jira ticket (CP-*, CLOUD-*), says 'implement', 'build', 'fix', 'work on', or describes a requirement. Plans, decomposes, and executes with multi-agent crew."
argument-hint: "<requirement>"
---

> **Preamble Tier: T4** (full orchestration — loads ALL shared contexts)
> See `_shared.md` § Preamble Tiers for the tier system.

# /team:start "$ARGUMENTS"

Router: context → plan → execute → verify → wrap.
Each phase reads/writes artifacts in `state/sessions/{TICKET}/`.
No git operations until wrap. All work is local.

<phase_a_context>

## Phase A: Context

1. Parse TICKET from $ARGUMENTS or `git branch --show-current`
2. Create `state/sessions/{TICKET}/` directory
3. Check for existing artifacts — if found, ask: resume or fresh?
4. If Jira MCP available: fetch ticket, extract acceptance criteria
5. Load `learnings/INDEX.md`, scan for relevant corrections
6. If Phantom MCP available: call `phantom_before_edit` for blast radius (non-blocking)
7. Write `state/sessions/{TICKET}/context.json` with `_meta` header
8. Activate cortex hook: `touch ~/.claude/team/.cortex-active`
9. **Detective check** — classify input as bug vs feature (see below)

</phase_a_context>

<detective_pre_scan>

## Phase A.5: Detective Pre-Scan (auto, bugs only)

Classify input as bug report if ANY match:
- Keywords in description: `bug`, `broken`, `regression`, `error`, `crash`, `failing`, `doesn't work`, `TypeError`, `undefined`, `null pointer`, `500`, `timeout`, `flaky`
- Jira issue type: Bug, Defect, Incident
- Branch prefix: `fix/`, `bugfix/`, `hotfix/`, `patch/`

If classified as bug → run lightweight detective pre-scan:

1. Identify suspect files from ticket description or error output
2. Run hotspot check: `git log --format=format: --name-only --since="6.months" -- {suspects} | sort | uniq -c | sort -rn`
3. Run ownership check: `git shortlog -sn --no-merges -- {suspects}` (top 3 files)
4. Add `detective` field to `context.json` (schema in `reference/detective-protocol.md`)
5. Report findings in 2-3 lines: "Detective pre-scan: {file} is a hotspot ({N} changes, bus factor {M})"

If NOT a bug → skip silently. No token cost for feature work.

If mixed signals → ask: "This might be a bug investigation. Run detective pre-scan first?"

Pre-scan feeds into Phase B planning — the plan accounts for hotspot risk and ownership data.

</detective_pre_scan>

<phase_b_plan>

## Phase B: Plan

1. Capture Intent — ask user or derive from Jira AC
   READ `reference/planning.md` for Intent format and protocol
2. Write `state/sessions/{TICKET}/intent.json`
3. Spawn Explore + Plan agents (opus) for codebase research
4. Scan `learnings/INDEX.md` for anti-repetition matches
5. Produce plan with SOLO/CREW routing (READ `reference/agents.md`)
6. Spawn Devil's Advocate (opus, blocking) — must reach PROCEED (max 2 rounds)
7. Write `state/sessions/{TICKET}/plan.json` with `devilsAdvocateVerdict`
8. Get user approval via ExitPlanMode

</phase_b_plan>

<phase_c_contracts>

## Phase C: Contracts

1. READ `reference/contracts.md` for templates
2. Create contracts → `state/sessions/{TICKET}/contracts/`

</phase_c_contracts>

<phase_d_execute>

## Phase D: Execute

1. READ `reference/agents.md` for spawn patterns
2. Dispatch agents per plan.json (SOLO: 1 spark. CREW: parallel with worktree isolation)
3. Agent results → `state/sessions/{TICKET}/agent-outputs/` (summary to conversation)
4. Write `state/sessions/{TICKET}/execution.json`
5. No git operations. All work is local.

</phase_d_execute>

<phase_e_verify_ship>

## Phase E: Verify + Ship

1. `Skill(skill="team:verify")` — writes verification.json
2. If PASS → `Skill(skill="team:wrap")` — ships and archives
3. If FAIL → `Skill(skill="team:fix")` → loop: fix → verify → wrap on pass

</phase_e_verify_ship>

<context_management>

## Context Management

Between any phase: if context is heavy, run `Skill(skill="team:pause")`.
User runs `/clear` then `/team:resume {TICKET}` to continue from the last artifact.

</context_management>
