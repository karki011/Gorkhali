---
name: team:verify
description: "Use when checking if code works, running tests, verifying changes, or before claiming work is done. Also use when user says 'does it pass', 'run tests', 'check the build', 'lint it', 'is it working', or 'test this'. Runs correctness checks (lint + build + tests) then a temperature review for quality."
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /team:verify

Three-step verification: correctness commands → temperature review → auto-address.

<instructions>

## Step 1: Correctness (commands, no agents)

Discover verify commands from repo (see `_shared-repo-detection.md` protocol):
- CLAUDE.md commands > repo scripts > stack defaults

Run each command. Read full output. Report:
- lint: pass/fail
- build: pass/fail
- tests: pass/fail

If ANY fail → run detective failure scan (see below), then print failures, suggest `/team:fix`. Stop here.

Run `Skill(skill="simplify")` on changed files. If changes produced → re-run correctness.

## Step 2: Temperature Review (1 agent)

Spawn ONE review agent (model: sonnet, mode: bypassPermissions):
- Input: `git diff main...HEAD` + intent from `state/sessions/{TICKET}/intent.json` (if exists) or conversation context
- Prompt: load from `reference/temperature-review.md` — the "Review Agent Prompt" section
- Output: JSON array of P0/P1 findings (P2/P3 dropped by the agent)

If output is `[]` → verdict: pass. Skip to Write Artifact.

<auto_address_loop>

## Step 3: Auto-Address (only if P0/P1 findings exist)

1. Spawn 1 fix agent with scoped P0+P1 findings
2. After fix → re-run Step 1 (correctness commands only)
3. Re-review ONLY the fix diff (not full codebase)
4. Max 2 auto-address loops
5. Clean after loop → verdict: pass
6. Still P0/P1 after 2 loops → escalate to user with findings

</auto_address_loop>

</instructions>

<detective_failure_scan>

## Detective Failure Scan (auto, on correctness failure)

When Step 1 correctness fails, before suggesting `/team:fix`:

1. Extract failing file paths from test/build/lint output
2. Run hotspot check on failing files: `git log --format=format: --name-only --since="6.months" -- {failing_files} | sort | uniq -c | sort -rn`
3. Run coupling check: find files that frequently co-change with the failing files
4. Check recent changes: `git log --oneline --since="2.weeks" -- {failing_files}`
5. Add `detective` field to verification.json (schema in `reference/detective-protocol.md`)
6. Report: "Detective scan: {file} has {N} changes in 6mo, coupled with {other_file} (strength {S}). Recent change by {author} on {date} may be relevant."

This scan adds ~5 seconds but gives fix.md structured evidence to work with instead of raw error output.

</detective_failure_scan>

## Write Artifact

Write `state/sessions/{TICKET}/verification.json`:

<output_format>

```json
{
  "_meta": {
    "writtenAt": "{ISO 8601 now}",
    "gitHead": "{HEAD sha}",
    "gitBranch": "{branch}",
    "phase": "verify",
    "skill": "team:verify",
    "version": 1
  },
  "correctness": {
    "lint": "pass",
    "build": "pass",
    "tests": "pass",
    "commands": ["{discovered commands}"]
  },
  "review": {
    "temperature": "clean|P0|P1",
    "findings": [],
    "fixLoops": 0
  },
  "simplifyRan": true,
  "intentAlignment": "aligned",
  "verdict": "pass|fail",
  "score": 8.0
}
```

</output_format>

## Result

- **PASS** → print summary, proceed to `/team:wrap`
- **FAIL** → print failures, suggest `/team:fix`
