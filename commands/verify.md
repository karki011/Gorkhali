---
name: team:verify
description: "Use when checking if code works, running tests, verifying changes, or before claiming work is done. Runs correctness checks + temperature review."
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

If ANY fail → print failures, suggest `/team:fix`. Stop here.

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
