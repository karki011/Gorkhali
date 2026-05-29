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

Spawn sage agent (opus, no tools, blocking):
- Input: complete plan + coding principles
- Output: Challenges (must address), Warnings (consider), Verdict
- PROCEED -> continue. REVISE -> address + re-run. RETHINK -> back to research.
- Max 2 iterations. Still RETHINK -> escalate to user.

## Codebase Research

Spawn Explore (opus) + Plan (opus) agents for:
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
| Test command | `pnpm test:changed` exits 0 |
| Lint/build | `pnpm lint && pnpm build` exits 0 |
| File existence | `[ -f src/foo.ts ]` |
| Grep match | `grep -r "export.*FooComponent" src/` finds a result |
| API/CLI output | `curl localhost:3000/health` returns `{"status":"ok"}` |
| Snapshot/diff | `git diff --name-only` includes expected file |

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

## Task Structure

See `schemas/plan.md` for the full task template, field rules, and extended fields (`read_first`, `acceptance_criteria`).
