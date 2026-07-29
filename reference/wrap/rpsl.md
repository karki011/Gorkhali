# Pre-Ship Review Panel (RPSL)

> **Context:** Called during `/phantom:wrap` after the Grill Gate passes. Expects `git diff main...HEAD` to be available and `intent.json` + `plan.json` in `{TEAM_DIR}/sessions/{TICKET}/`. No PR ships without all four agents passing. No override. No skip flag.

## Protocol

Multi-perspective collision analysis. Four agents review the full `git diff main...HEAD` in parallel, each from a different angle. All four must pass.

**Spawn 4 agents in parallel** (all session-model, mode: bypassPermissions, run_in_background: false):

Apex creates `{SESSION_DIR}/reviews/` before spawning agents to ensure all four can write their verdict files concurrently without path errors.

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

**This section addresses the four review agents, not Apex.** Your deliverable is a file you write yourself. The file is the record; your final message is commentary on it.

As soon as you hold a verdict you are prepared to stand behind - after investigating, before refining anything and before running any long command - write `{SESSION_DIR}/reviews/{role}.json`:

```json
{
  "role": "scope|regression|architecture|skeptic",
  "verdict": "pass|fail",
  "findings": ["..."],
  "confidence": "checked:clean|checked:concerns|not_observed"
}
```

- **One file per role, never one shared file.** `reviews/scope.json`, `reviews/regression.json`, `reviews/architecture.json`, `reviews/skeptic.json`. The four agents run in parallel, so concurrent writes to a single file are a real race with no locking available - findings would be silently overwritten.
- **Keep the file current.** If continued review flips your verdict or adds a finding, rewrite the file at once. Never hold a finding in prose only; Apex treats the file as authoritative and your chat summary as commentary.
- **Then** summarise in chat. If the turn ends before that summary, the verdict is already on disk and nothing is lost.

Apex reads `{SESSION_DIR}/reviews/*.json` and merges the four into `review-panel.json`. It does not transcribe agents' final messages.

### Empty-Result Guard

Before computing the panel decision, Apex checks that all four `reviews/*.json` exist and each carries a verdict. Any that is missing, empty, or verdict-less - including an agent that returned no output at all while its task notification still said completed - gets ONE `SendMessage` resume (by agent id or name, never a respawn) asking it to write its artifact.

This is resume-then-proceed, not a terminal block. After that single resume attempt Apex computes the panel decision from what is on disk, recording each still-missing perspective in `review-panel.json` findings with `confidence: not_observed`. The guard exists to recover a lost deliverable; it never becomes a second gate and it must never wedge a wrap with no escape hatch. The Panel Decision rule below stays authoritative.

## Panel Decision

- **ALL PASS** -> write `review-panel.json`, proceed to ship
- **ANY FAIL** -> write `review-panel.json` with `allPass: false`, **STOP**. Print all findings grouped by perspective. User must address blockers and re-run `/phantom:wrap`.
- Write `{TEAM_DIR}/sessions/{TICKET}/review-panel.json` (see `artifact-schemas.md`)
