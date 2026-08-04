---
name: validate
description: "Retroactive audit of a finished session — checks plan completeness and that outputs satisfy the contracts/requirements. Also use when user says 'validate the session', 'check outputs against the contract', or 'did we cover all the requirements'. NOT for code quality review (use phantom:review), test/build runs (use phantom:verify), or repairing failures (use phantom:fix)."
argument-hint: "[layer]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
# Generic affirm-check triggers ('sanity check', 'did we miss anything', 'is this complete') are intentionally muted by user-invocable:false — validate is an internal/orchestration step, not auto-selected from NL. Do not flip this flag without re-checking auto-dispatch safety against verify/review/approve.
user-invocable: false
---

> **Preamble Tier: T2** — loads '_shared.md' + '_shared-repo-detection.md' + '_shared-auto-learning.md'

# /phantom:validate $ARGUMENTS

Run validation scripts to check shadows guidance compliance. Layers: `plan`, `output`, `session`, `all`.

**Scripts location:** `{PLUGIN_ROOT}/scripts/` — self-resolve {PLUGIN_ROOT} env-free: `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install; validation skipped"; exit 0; }` (gate-critical — the validate scripts ARE the skill; empty `$PR` aborts readable, never `$PR/scripts/...` with an empty `$PR`)

---

<validation_coordination>

## Coordinator Role (Main LLM)

You are the coordinator. You do NOT run validation scripts directly. Instead:

1. **Parse $ARGUMENTS** to determine which layer(s): `plan`, `output`, `session`, or `all`
2. **Resolve paths**: session board JSON path (`${PHANTOM_DATA:-~/.phantom}/repos/{REPO_NAME}/sessions/{TICKET}.json`), project root
3. **Spawn a Ward agent** to execute the validation scripts and collect results
4. **Present findings** to the user with pass/fail summary and actionable items

</validation_coordination>

<ward_agent>

## Ward Agent Dispatch

Spawn a single **Ward** agent for all requested layers. Ward runs scripts sequentially and returns structured findings.

**Agent configuration:**
- subagent_type: `ward` (effort = session `high`; model per `reference/agents.md` → Model Routing)
- mode: `bypassPermissions`
- If only one layer requested, Ward runs that layer's script. For `all`, Ward runs all three in sequence.

**Ward prompt must include:**
- The specific layer(s) to validate
- Full script paths and arguments (from the table below)
- The session JSON path and project root
- Instructions to return structured JSON: `{ layer: string, passed: boolean, findings: string[] }[]`

</ward_agent>

<validation_layers>

## Validation Layer Reference

Pass these to Ward's prompt so it knows what to run and what each script checks.

### Layer: `plan`

```bash
$PR/scripts/validate-plan.sh "${PHANTOM_DATA:-$HOME/.phantom}/repos/{REPO_NAME}/sessions/{TICKET}.json"
```

Checks: phase order (Gaze -> Ward -> Gaze (gauntlet mode) -> Lens -> User Feedback), Lens inclusion for UI/Figma tasks, file ownership conflicts, task assignees, phase owners.

### Layer: `output`

```bash
$PR/scripts/validate-output.sh <agent-name> "<file1>,<file2>" /path/to/project
```

Checks: file ownership violations, copyright headers, inline hex/px values, barrel exports, filename conventions.

### Layer: `session`

```bash
$PR/scripts/validate-session.sh "${PHANTOM_DATA:-$HOME/.phantom}/repos/{REPO_NAME}/sessions/{TICKET}.json"
```

Checks: required fields, phase/task status enums, verification block after verify phase, visual verification block when visualVerify: true, loop count bounds, board JSON freshness.

### Layer: `all`

Ward runs all three scripts in sequence (`plan` → `output` → `session`). Returns combined findings.

</validation_layers>

<results_presentation>

## Presenting Results

After Ward returns, the coordinator:

1. Parse Ward's structured findings
2. Show a summary table: layer | status (PASS/FAIL) | finding count
3. List each finding with severity and suggested fix
4. If all layers pass: confirm clean validation
5. If any layer fails: highlight blockers and suggest next action (fix, re-run specific layer)

</results_presentation>

---

## Automatic Validation (built into execution flow)

- **PreToolUse hook** on Agent calls validates `mode: "bypassPermissions"`, `run_in_background: true`, model tier, and prompt content. BLOCKs bad spawns automatically.
- **Apex** runs `validate-plan.sh` before Phase C execution starts.
- **Apex** runs `validate-output.sh` after each agent completes (with that agent's owned files).
- **Apex** runs `validate-session.sh` at phase transitions and after verify/fix loops.
