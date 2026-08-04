# Planning Protocol

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

## Rival (mandatory, every plan)

Spawn sage agent (top tier via agent definition — opus / Opus 5; no tools, blocking):
- Input: complete plan + coding principles
- Output: Challenges (must address), Warnings (consider), Verdict
- PROCEED -> continue. REVISE -> address + re-run. RETHINK -> back to research.
- Max 2 iterations. Still RETHINK -> escalate to user.

## Codebase Research

Spawn Explore (session model) + Plan (session model) agents for:
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

---

## Plan Quality Rules

### Machine-Checkable Acceptance Criteria

Every `doneWhen` entry in `intent.json` must be verifiable by one of:

| Type | Form |
|------|------|
| Test command | `{TEST_CMD}` exits 0 |
| Lint/build | `{LINT_CMD} && {BUILD_CMD}` exits 0 |
| File existence | `[ -f src/foo.ts ]` |
| Grep match | `grep -r "export.*FooComponent" src/` finds a result |
| API/CLI output | `curl localhost:{DEV_PORT}/health` returns `{"status":"ok"}` |
| Snapshot/diff | `git diff --name-only` includes expected file |

`{TEST_CMD}` / `{LINT_CMD}` / `{BUILD_CMD}` / `{TYPECHECK_CMD}` are resolved via the discovery protocol in `reference/verification.md`. `{DEV_PORT}` comes from dev-server config or framework startup output — never assume a fixed port.

**Banned forms** (plan fails immediately if any appear):
```
TBD / TODO / TBC
"similar to Task N"
"etc." / "and so on"
"as needed" / "if necessary" / "where appropriate"
"appropriate error handling"
"proper validation"
"update tests accordingly"
```

If any appear in `doneWhen`, `description`, or `action` fields -- the plan is incomplete. Rewrite as a command or observable fact.

### Requirement Coverage

Before finalizing `plan.json`, trace every `doneWhen` entry to at least one task:
```
intent.doneWhen[i]  ->  plan.tasks[j].description  (must match)
```
A `doneWhen` with no matching task is a coverage gap. Either add a task or remove the criterion.

### Placeholder Prohibition

The apex agent MUST reject `plan.json` with `verdict: REVISE` if:
- Any task `description` contains banned terms above
- Any `doneWhen` is not independently verifiable (no command, no file, no grep)
- Any task has `files: []` (every task must touch at least one file)
- `dependsOn` references a non-existent task ID

### Research-Free Tasking

Every task handed to an implementer must arrive research-free.
Apex resolves all open questions during planning: `read_first` paths, exact files, the pattern or example to follow, and the contract.
If executing a task would require the implementer to explore the codebase, search docs, or make a design decision, the plan is incomplete - re-decompose the task instead of escalating its model.
Raising the implementer model is never a remedy for weak scoping, and `fable` is never a legal implementer model (enforced by `hooks/blade-model-gate.js`).

## Task Structure

See `schemas/plan.md` for the full task template, field rules, and extended fields (`read_first`, `acceptance_criteria`).

## Plan Artifacts

Every plan produces three required files, each with one job, plus one optional fourth:

- **`plan.json`** — the machine source of truth. `phantom:execute`, `phantom:wire`, and `phantom:resume` all read this file, never `plan.html`.
- **`plan.candidate.html`** — a disposable, self-contained review candidate authored by the active AI from `plan.json` and, when present, `plan-check.json`. It is never canonical and is never parsed back into anything.
- **`plan.html`** — the accepted human gate surface. The review HTML validator promotes a valid `plan.candidate.html` to this file; see `commands/start.md` PLAN route, HUMAN GATE step.
- **`plan-check.json`** (optional) — the plan-checker's verdict, written to the session directory by the plan-checker agent (`agents/plan-checker.md`). When present, the active AI receives it with `plan.json` and includes its verdict in the review provenance. Absent means the plan-checker did not run, or was not required for this route.

If `plan.json` changes after the initial review — during deliberation, a fix-loop revision, or a resumed session — have the active AI generate a fresh candidate, validate/promote it, and use that accepted `plan.html` before the next requested human review.

### Gate-loop revisions

During plan-gate chat feedback, apply material feedback to `plan.json`; presentation-only feedback leaves JSON unchanged. Neither HTML file is a source of truth. Re-run plan-checker for a material change and Rival when scope changes, then generate a fresh candidate from the applicable source plus feedback and validate/promote it before a requested re-review. Record each material revision in `{SESSION_DIR}/decisions.json`, including the feedback, plan changes, and recheck result. Chat approval remains the only gate exit.

## Decision-First Plan Artifact (mandatory at every plan gate)

A plan is a researched recommendation before it is an execution manifest. Every
new plan sets `_meta.version: 3` and records the decision, outcome, architecture,
evidence, alternatives, assumptions, risks, validation strategy, and execution
appendix defined in `schemas/plan.md`. This applies to implementation tickets as
well as research tickets; otherwise a schema-valid plan can collapse into tasks
and waves while hiding why those tasks are correct.

Set `depth` to `quick`, `standard`, or `deep`. Quick plans still require a
decision, outcome, evidence, scope, validation, and concrete task contract, but
may use `alternatives: []` and omit `solution_shape` and task-local
risk/recovery when they are genuinely not applicable. Do not invent architecture
or fake alternatives to satisfy a template. Standard and deep plans require the
full architecture, alternatives, and recovery contract.

For standard/deep depth, completeness means useful content, not populated keys.
Give evidence a decision implication; alternatives distinct benefits, costs,
rejection reasons, and reconsideration conditions; assumptions confidence,
impact, and validation; and risks likelihood, impact, trigger, mitigation, and
recovery. Use 2-4 substantive rationale points. Every task must be an executable
dossier with enough context that its implementer does not need to rediscover a
design choice. Quick plans stay concise and never invent filler.

Use evidence states instead of unsupported numeric confidence:
`verified`, `supported`, `inferred`, or `unknown`. Every evidence item cites a
repository location, command result, or authoritative URL. Keep unresolved
questions explicit and mark whether they block approval.

### Human review order

The active AI authors a self-contained, full-width HTML review candidate. It chooses the visual
design appropriate to the plan, but must organize the human review around this order:

1. Executive decision brief: approval question, recommendation, rationale, and pending calls.
2. Outcome, scope, and architecture.
3. Research findings, evidence, alternatives, assumptions, and risks.
4. Validation strategy and observable definition of done.
5. Execution appendix: affected files, waves, task dossiers, and dependencies.
6. Plan-check, review provenance, and unrecognized compatibility fields.

The first screen must answer what is being approved, what Phantom recommends,
why, what remains uncertain, and what happens if the choice is wrong. Tasks and
waves never lead the gate.

### AI-authored review HTML

`plan.json` remains the machine source of truth. The active AI authors
`plan.candidate.html`; `node {PLUGIN_ROOT}/skills/phantom/scripts/validate-review-html.mjs plan
--source {SESSION_DIR}/plan.json --candidate {SESSION_DIR}/plan.candidate.html --out
{SESSION_DIR}/plan.html` validates and promotes it. Never patch either HTML file by hand and never
parse HTML back into the plan. If candidate generation, validation, or opening is unavailable,
present the same decision-first structure in chat and record the capability fallback rather than
degrading to a task-only plan.
