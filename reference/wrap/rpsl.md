# Pre-Ship Review Panel (RPSL)

> **Context:** Called during `/phantom:wrap` after the Grill Gate passes. Expects `git diff main...HEAD` to be available and `intent.json` + `plan.json` in `state/sessions/{TICKET}/`. No PR ships without all four agents passing. No override. No skip flag.

## Protocol

Multi-perspective collision analysis. Four agents review the full `git diff main...HEAD` in parallel, each from a different angle. All four must pass.

**Spawn 4 agents in parallel** (all opus, mode: bypassPermissions, run_in_background: false):

### 1. Scope Agent — "Does this diff match the contract?"
- Reads: `intent.json` (doneWhen + specDelta), `plan.json` (tasks + files), full diff
- Checks: Every changed file traceable to a plan task. No files outside plan scope. specDelta is consistent with actual changes.
- Verdict: PASS if all changes are in scope. FAIL if scope creep detected (list the files).

### 2. Regression Agent — "Could this break existing functionality?"
- Reads: Full diff, test output from verification.json, witness-fixes.json
- Checks: No removed test coverage. No deleted assertions. No weakened type signatures. Witness markers intact. No `any` casts added.
- Verdict: PASS if no regression risk. FAIL if regression vectors found (list them).

### 3. Architecture Agent — "Does this follow codebase patterns?"
- Reads: Full diff, CLAUDE.md, `.claude/rules/`, existing similar files
- Checks: Import patterns match codebase. Naming conventions followed. No new anti-patterns. Component structure consistent with neighbors.
- Verdict: PASS if architecturally sound. FAIL if pattern violations found.

### 4. Skeptic Agent — "What's the weakest part? What breaks in production?"
- Reads: Full diff, intent.json, error handling paths
- Checks: Edge cases (null, empty, timeout, concurrent). Error messages actionable. No silent failures. No hardcoded values that should be configurable.
- Verdict: PASS if production-ready. FAIL if critical production risks found.

## Agent Output Format

Each agent outputs:
```json
{
  "role": "scope|regression|architecture|skeptic",
  "verdict": "pass|fail",
  "findings": ["..."],
  "confidence": "checked:clean|checked:concerns|not_observed"
}
```

## Panel Decision

- **ALL PASS** -> write `review-panel.json`, proceed to ship
- **ANY FAIL** -> write `review-panel.json` with `allPass: false`, **STOP**. Print all findings grouped by perspective. User must address blockers and re-run `/phantom:wrap`.
- Write `state/sessions/{TICKET}/review-panel.json` (see `artifact-schemas.md`)
