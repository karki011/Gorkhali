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

## Codebase Research (delegated, `research` profile)

Chief does not read project source to plan. It spawns the planner, blocking, in two passes (`hooks/engineer-model-gate.js` admits the `planner-` alias on `engineer` spawns), and ingests each result by `jq` extract:

**Draft pass** (before Opposition; writes `plan.json` only, no HTML yet):
```
Agent call:
  description: "Planner: research + draft plan.json for {TICKET}"
  subagent_type: "engineer"
  name: "planner-drafton"
  mode: "bypassPermissions"
  model: "<resolved>"   # node "$PR/skills/gorkhali/scripts/resolve-profile.mjs" --role engineer --profile research --host claude-code → `opus`
  prompt: |
    You are an ENGINEER with ROLE FOCUS: planner (research + plan authoring; NO project-source edits).
    Intent: {SESSION_DIR}/intent.json. Ticket AC: {inline, already extracted}. Learnings corrections: {inline}.
    Research the codebase yourself: file structure and patterns, existing similar implementations,
    import/dependency chains, and every `read_first` path a task will need.
    Write {SESSION_DIR}/plan.json per `reference/schemas/plan.md` (_meta.version 3). Leave `oppositionVerdict`
    unset and do NOT author any HTML: Opposition has not run yet.
    Write research notes to {SESSION_DIR}/agent-outputs/planner.md.
    Return ONLY: briefing (What / Problem / How, <=8 lines), task table (id · files · dependsOn).
```

**Finalize pass** (after EVERY Opposition verdict, PROCEED included; same spawn name):
```
    Finalize {SESSION_DIR}/plan.json against {SESSION_DIR}/plan-check.json: set `oppositionVerdict` from its
    verdict; on REVISE also address each challenge (and this gate feedback, if any: ...). Write the briefing in
    plain English per `skills/gorkhali/references/planning.md` -> "The briefing is written in plain English".
    Then author {SESSION_DIR}/plan.candidate.html for the ARTIFACT target per
    `skills/gorkhali/references/review-html.md` and promote it with validate-review-html.mjs --target artifact
    (command in start.md PLAN gate). Do NOT publish it; Chief owns the artifact URL. Return ONLY: verdict
    recorded, changed task ids, validator exit code.
```

The HTML is generated only after `plan-check.json` exists, so the gate page always carries Opposition provenance and `plan.json` never guesses its verdict. Chief passes paths, not the challenges' text; a REVISE round is finalize → Opposition → finalize again.

Spawn `explore-farwick` (native `Explore`, same `research` model) alongside only when the blast radius is unfamiliar or crosses repos; it returns a <=40-line survey that Chief forwards to the planner inline. Never spawn it to answer a question Chief could settle from `intent.json`.

After each planner pass, Chief reads `jq '.briefing, .oppositionVerdict, [.tasks[] | {id, files, dependsOn}]' plan.json` and nothing else from it.

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
- **`plan.candidate.html`** — a disposable review candidate authored by the active AI from `plan.json` and, when present, `plan-check.json`. It is never canonical and is never parsed back into anything.
- **`plan.html`** — the accepted human gate surface. The review HTML validator promotes a valid `plan.candidate.html` to this file; see `commands/start.md` PLAN route, HUMAN GATE step. On this host it is an artifact-target fragment that Chief publishes with the `Artifact` tool; the user reviews the published URL, not the local file.
- **`plan-check.json`** (optional) — Opposition's verdict, written to the session directory by the Opposition agent (`agents/opposition.md`). When present, the active AI receives it with `plan.json` and includes its verdict in the review provenance. Absent means Opposition did not run, or was not required for this route.

If `plan.json` changes after the initial review — during deliberation, a fix-loop revision, or a resumed session — have the active AI generate a fresh candidate, validate/promote it, and use that accepted `plan.html` before the next requested human review.

### Gate-loop revisions

During plan-gate chat feedback, apply material feedback to `plan.json`; presentation-only feedback leaves JSON unchanged. Neither HTML file is a source of truth. Re-run Opposition for a material change, then generate a fresh candidate from the applicable source plus feedback and validate/promote it before a requested re-review. Record each material revision in `{SESSION_DIR}/decisions.json`, including the feedback, plan changes, and recheck result. Chat approval remains the only gate exit.

### AI-authored review page

`plan.json` remains the machine source of truth. The active AI authors
`plan.candidate.html`; `node {PLUGIN_ROOT}/skills/gorkhali/scripts/validate-review-html.mjs plan
--source {SESSION_DIR}/plan.json --candidate {SESSION_DIR}/plan.candidate.html --out
{SESSION_DIR}/plan.html --target artifact` validates and promotes it. Never patch either HTML file by
hand and never parse HTML back into the plan.

This host exposes the `Artifact` tool, so `review.artifact` is available and the target is `artifact`
(`skills/gorkhali/references/capabilities.md`). Chief publishes the accepted `plan.html` itself rather
than delegating it, so one session owns one plan URL:

```text
Artifact(file_path: "{SESSION_DIR}/plan.html", favicon: "<one emoji>",
         description: "<one sentence: what this plan decides>")
```

Republish the same `file_path` on every revision round so the URL is stable for the whole session; omit
`favicon` on a republish. If publishing fails or is declined, regenerate for the `file` target and open
the local page instead, and record the fallback. Never present a plan URL that a publish result did not
return.
