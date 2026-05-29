---
name: phantom:verify
description: "Use when checking if code works, running tests, verifying changes, or before claiming work is done. Also use when user says 'does it pass', 'run tests', 'check the build', 'lint it', 'is it working', or 'test this'. Runs correctness checks (lint + build + tests) then a power level for quality."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:verify

Three-step verification: correctness commands → power level → auto-address.

<instructions>

## Step 1: Correctness (commands, no agents)

Discover verify commands from repo (see `_shared-repo-detection.md` protocol, `reference/verification.md` for tier precedence).

Run each command. Read full output. Report: lint pass/fail, build pass/fail, tests pass/fail.

If ANY fail → run hound failure scan (Step 1.5), print failures, suggest `/phantom:fix`. Stop.

Spawn sweep agent (`subagent_type: "sweep"`, `mode: "bypassPermissions"`) on changed files using `agents/sweep.md`. If changes produced → re-run correctness. (model + effort come from the agent definition)

### Step 1.5: Hound Failure Scan (auto, on failure)

1. Extract failing file paths from output
2. Hotspot + coupling check on failing files (recipes from `_shared-hound.md`)
3. Recent changes: `git log --oneline --since="2.weeks" -- {failing_files}`
4. Add `hound` field to verification.json (schema in `reference/detective/depth-levels.md`)
5. Report: "{file} has {N} changes in 6mo, coupled with {other_file} (strength {S})"

## Step 2: Power Level (1 agent)

Spawn ONE review agent (`subagent_type: "gaze"`, `mode: "bypassPermissions"`):
- Input: `git diff main...HEAD` + intent from session
- Prompt: load from `reference/power-level.md` — "Review Agent Prompt" section
- Output: JSON array of P0/P1 findings (P2/P3 dropped)

If `[]` → verdict: pass. Skip to Write Artifact.

## Step 3: Auto-Address (only if P0/P1 exist)

1. Spawn 1 fix agent (`subagent_type: "blade"`, `mode: "bypassPermissions"`) with scoped findings
2. Re-run Step 1 correctness only
3. Re-review ONLY the fix diff
4. Max 2 loops. Clean → pass. Still P0/P1 → escalate to user.

</instructions>

## Write Artifact

Write `{TEAM_DIR}/sessions/{TICKET}/verification.json`. Schema in `reference/schemas/verification.md`.

Key fields: `_meta`, `correctness` (lint/build/tests/commands), `review` (temperature/findings/fixLoops), `simplifyRan`, `intentAlignment`, `verdict`, `score`.

## Result

- **PASS** → print summary, proceed to `/phantom:wrap`
- **FAIL** → print failures, suggest `/phantom:fix`
