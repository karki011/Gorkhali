---
name: contract
description: "Optional projection of an approved plan.json for API/UI interface details; NOT a planning gate."
argument-hint: "<type>"
# Generic triggers ('scope this', 'what are the requirements') are intentionally muted by user-invocable:false — contract is dispatched by gorkhali:start, not auto-selected from NL. Do not flip this flag without re-checking auto-dispatch safety.
user-invocable: false
---

> **Preamble Tier: T3** — shared contexts per the canonical registry (`scripts/preamble-tier.js`)

# /gorkhali:contract $ARGUMENTS

Optional **projection** of an already-approved `plan.json`. It is not a planning
gate and not a fifth source of truth beside `intent.json` and `plan.json`.
Do not invoke this before the plan is approved. Missing contract files never
block execute, verify, or wrap.

Valid types: `feature`, `api`, `testing`, `ui`, `fix`. Prefer `api` and `ui` —
those are the only types that add interface detail `plan.json` does not already
carry. `feature` / `testing` / `fix` usually duplicate the plan; skip them.

1. Determine the active ticket from `state/current.json`
2. Read `plan.json` first. Fill known fields from `scope`, `solution_shape`,
   and task `acceptance_criteria`. Do not invent a parallel goal.
3. Read the template from `.claude/contracts/{type}/_template.md` (repo-level) OR use `reference/contract/contract-template.md` (built-in)
4. Present the draft to the user as a projection of the plan; open its HTML directly when useful and collect feedback in chat
5. Save to `sessions/{TICKET}/contracts/{type}.html`
6. Optionally copy to `.claude/contracts/{type}/{TICKET}.html` for repo persistence
7. Update session state with contract status — informational only, never a gate
