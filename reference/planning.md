# Planning Protocol

Canonical: `skills/gorkhali/references/planning.md`

That portable reference owns the shared planning contract: establishing current
truth, route classification, defect investigation, decision artifacts, plan
quality rules (machine-checkable acceptance criteria, requirement coverage,
placeholder prohibition, research-free tasking), the decision-first plan
artifact, the human review order, and approval collection. This file keeps only
the native-host mechanics that cannot move: roster-bound spawn sites and the
native session-artifact layout.

## Intent Capture (mandatory)

```
Goal:            [success in one sentence]
Done When:       [machine-checkable exit conditions -- verifiable predicates]
Priority:        [speed | quality | ux | stability | scope -- ranked]
Tradeoffs:       [what CAN be sacrificed]
Non-negotiables: [what MUST NOT be compromised]
Spec Delta:      [what changed from original requirements -- or "none" if first pass]
```

Done When sourcing: 1) Jira AC if available, 2) ask user if no Jira, 3) format as verifiable predicates.

### Spec Delta Tracking

Every planning action produces a `specDelta` entry in `intent.json`:
- **Changed**: describe what changed and why
- **Unchanged**: `"specDelta": "none -- original requirements unchanged"`
- **Narrowed/expanded**: record what was cut/added and rationale

Pre-Ship Review Panel checks `specDelta` during wrap to verify scope alignment.

## Opposition (mandatory, every plan)

Spawn the Opposition agent, blocking (`subagent_type: "opposition"`, `name: "opposition-parlow"` per `reference/roster.md`):
- Input: complete plan + coding principles
- Output: Challenges (must address), Warnings (consider), Verdict, plus `plan-check.json` in the session directory
- Record the verdict as `oppositionVerdict` (`PROCEED` | `REVISE` | `RETHINK`). The legacy key `devilsAdvocateVerdict` is still read; do not write it on new plans.
- PROCEED -> continue. REVISE -> address + re-run. RETHINK -> back to research.
- Max 2 iterations. Still RETHINK -> escalate to user.

One gate, both jobs: Opposition is the single plan critic, so this spawn satisfies the deliberation challenge (`reference/router/deliberation.md`) and decomposition validation (learnings collisions, blast radius, coverage, scope, dependency order) at once. There is no separate plan-check pass.

## Codebase Research

Spawn Explore (session model, `name: "explore-farwick"`) + Plan (session model, `name: "planner-drafton"`; `subagent_type` passed to `Agent` is still `Plan` — see `reference/roster.md`'s Explore / Planner note) agents for:
- File structure and patterns
- Existing similar implementations
- Import/dependency chains

## Anti-Repetition Check

Before finalizing plan:
1. Scan `learnings/INDEX.md` for matching corrections
2. `[failed]` entries -> acknowledge, explain difference, or choose alternative
3. Log matches in plan under anti-repetition notes

## SOLO vs SHADOWS Decision

See `reference/agents.md` for routing table.

## Task Structure

See `schemas/plan.md` for the full task template, field rules, and extended fields (`read_first`, `acceptance_criteria`). Research-free tasking is canonical in the portable reference; `hooks/engineer-model-gate.js` is its native enforcement, and `fable` is never a legal implementer model.

## Plan Artifacts

Native session-file layout for the canonical decision-first plan:

- **`plan.json`** — the machine source of truth. `gorkhali:execute`, `gorkhali:wire`, and `gorkhali:resume` all read this file, never `plan.html`. Every new plan sets `_meta.version: 3` and `depth` to `quick`, `standard`, or `deep`.
- **`plan.candidate.html`** — a disposable, self-contained review candidate authored by the active AI from `plan.json` and, when present, `plan-check.json`. It is never canonical and is never parsed back into anything.
- **`plan.html`** — the accepted human gate surface. The review HTML validator promotes a valid `plan.candidate.html` to this file; see `commands/start.md` PLAN route, HUMAN GATE step.
- **`plan-check.json`** (optional) — Opposition's verdict, written to the session directory by the Opposition agent (`agents/opposition.md`). When present, the active AI receives it with `plan.json` and includes its verdict in the review provenance. Absent means Opposition did not run, or was not required for this route.

If `plan.json` changes after the initial review — during deliberation, a fix-loop revision, or a resumed session — have the active AI generate a fresh candidate, validate/promote it, and use that accepted `plan.html` before the next requested human review.

### Gate-loop revisions

During plan-gate chat feedback, apply material feedback to `plan.json`; presentation-only feedback leaves JSON unchanged. Neither HTML file is a source of truth. Re-run Opposition for a material change, then generate a fresh candidate from the applicable source plus feedback and validate/promote it before a requested re-review. Record each material revision in `{SESSION_DIR}/decisions.json`, including the feedback, plan changes, and recheck result. Chat approval remains the only gate exit.

### AI-authored review HTML

`plan.json` remains the machine source of truth. The active AI authors
`plan.candidate.html`; `node {PLUGIN_ROOT}/skills/gorkhali/scripts/validate-review-html.mjs plan
--source {SESSION_DIR}/plan.json --candidate {SESSION_DIR}/plan.candidate.html --out
{SESSION_DIR}/plan.html` validates and promotes it. Never patch either HTML file by hand and never
parse HTML back into the plan.
