# Pre-Ship Review Panel (RPSL)

> **Context:** Called during `/phantom:wrap` after the Grill Gate passes. Expects `git diff main...HEAD` to be available and `intent.json` + `plan.json` in `{TEAM_DIR}/sessions/{TICKET}/`. A failing perspective stops the ship. No override. No skip flag. A perspective that produced no verdict at all is a different case and is handled by the Panel Decision below.

## Protocol

Multi-perspective collision analysis. Four agents review the full `git diff main...HEAD` in parallel, each from a different angle. All four must pass for a clean ship.

**Spawn 4 agents in parallel** (all session-model, mode: bypassPermissions, run_in_background: false) using the exact spawn spec in `commands/wrap.md` Step 4 — `name:` one of `archer-scope`, `archer-regression`, `archer-architecture`, `archer-skeptic` per `reference/roster.md` Rule 2 (function-named, not character-named):

Apex creates `{SESSION_DIR}/reviews/` before spawning agents to ensure all four can write their verdict files concurrently without path errors. In the same step it deletes `reviews/scope.json`, `reviews/regression.json`, `reviews/architecture.json` and `reviews/skeptic.json` if they exist.

The clear is load-bearing on a re-run. The ANY FAIL path below sends the user off to fix blockers and re-run `/phantom:wrap`, so the directory still holds the previous run's verdicts. The Empty-Result Guard checks that a role file is present and carries a verdict; it does not check freshness. A reviewer that truncates before rewriting its file therefore leaves the old one in place, the guard reads it as a satisfied perspective, skips the resume, and the panel can count a pass produced against an earlier git HEAD.

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
  "confidence": "checked:clean|checked:concerns"
}
```

- **Why this enum is narrower than the merged schema's.** `reference/schemas/review-panel.md` also allows `confidence: not_observed`, but that value belongs to Apex at merge time, for a perspective that never produced a verdict. A reviewer alive enough to write this file has by definition observed something, so it only ever writes `checked:clean` or `checked:concerns`.
- **One file per role, never one shared file.** `reviews/scope.json`, `reviews/regression.json`, `reviews/architecture.json`, `reviews/skeptic.json`. The four agents run in parallel, so concurrent writes to a single file are a real race with no locking available - findings would be silently overwritten.
- **Keep the file current.** If continued review flips your verdict or adds a finding, rewrite the file at once. Never hold a finding in prose only; Apex treats the file as authoritative and your chat summary as commentary.
- **Then** summarise in chat. If the turn ends before that summary, the verdict is already on disk and nothing is lost.

Apex reads exactly four files - `{SESSION_DIR}/reviews/scope.json`, `{SESSION_DIR}/reviews/regression.json`, `{SESSION_DIR}/reviews/architecture.json`, `{SESSION_DIR}/reviews/skeptic.json` - and merges those into `review-panel.json`. It does not transcribe agents' final messages.

Read those names; do not glob the directory. `agents/gaze.md` writes `reviews/gaze.json` on every Gaze run, and `commands/verify.md` spawns Gaze during verification, which wrap runs before this panel - so at merge time a fifth file that is not a panel perspective is normally already on disk. `reference/schemas/review-panel.md` restricts `perspectives[].role` to `scope|regression|architecture|skeptic`, so merging that fifth file yields a schema-invalid panel.

### Empty-Result Guard

Before computing the panel decision, Apex checks that all four role files named above exist and each carries a verdict. Any that is missing, empty, or verdict-less - including an agent that returned no output at all while its task notification still said completed - gets ONE `SendMessage` resume (by agent id or name, never a respawn) asking it to write its artifact.

This is resume-then-proceed, not a terminal block. After that single resume attempt Apex computes the panel decision from what is on disk. Each still-missing perspective is recorded in `review-panel.json` with `verdict: not_observed` and `confidence: not_observed`, a `findings` entry saying no verdict reached disk, and a `blockers[]` entry naming the perspective and what went unreviewed. The guard exists to recover a lost deliverable; it never becomes a second gate and it must never wedge a wrap with no escape hatch. The Panel Decision rule below stays authoritative.

`not_observed` is a verdict, not a pass wearing a label. `reference/schemas/review-panel.md` forbids pairing `verdict: pass` with `confidence: not_observed` for exactly that reason - an unreviewed perspective must not be recordable as a reviewed clean one. Do not substitute a `pass` for a missing file, and do not substitute a `fail` either: a fail sends the user off to fix blockers that no reviewer actually found.

A missing role file is unambiguous here, so no freshness check is needed. The pre-spawn step above clears all four files before the panel runs, so absent at this point means this run produced nothing, never "possibly stale from an earlier run".

## Panel Decision

Three outcomes, decided in this order - a FAIL anywhere wins over any number of unobserved perspectives:

- **ALL PASS** -> write `review-panel.json` with `allPass: true`, proceed to ship
- **ANY FAIL** -> write `review-panel.json` with `allPass: false`, **STOP**. Print all findings grouped by perspective. User must address blockers and re-run `/phantom:wrap`. A reviewer looked and found a blocker; there is no override and no skip flag for this path.
- **ANY NOT_OBSERVED, no FAIL** -> write `review-panel.json` with `allPass: false`, print which perspectives went unreviewed, and proceed to the draft PR. The ship ceremony must name each `not_observed` perspective in the PR body (`reference/wrap/ship-ceremony.md`), so the gap travels with the code to the human reviewer instead of dying with the terminal session. This is the only path that ships with `allPass: false`.
- Write `{TEAM_DIR}/sessions/{TICKET}/review-panel.json` (see `artifact-schemas.md`)

The third branch is what keeps the Empty-Result Guard honest. Without it a lost deliverable had only two spellings available, both wrong: `pass` ships unreviewed code as reviewed, and `fail` wedges the wrap on blockers nobody found. Shipping a draft PR that states the gap is strictly more information than either.
