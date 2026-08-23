---
name: validate
description: "Retroactive audit of a finished session — checks plan completeness and that outputs satisfy contracts/requirements. Code review → gorkhali:review; test/build → gorkhali:verify; repairs → gorkhali:fix."
argument-hint: "[layer]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
# Generic affirm-check triggers ('sanity check', 'did we miss anything', 'is this complete') are intentionally muted by user-invocable:false — validate is an internal/orchestration step, not auto-selected from NL. Do not flip this flag without re-checking auto-dispatch safety against verify/review/approve.
user-invocable: false
---

> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger

# /gorkhali:validate $ARGUMENTS

Run validation scripts to check shadows guidance compliance. Layers: `plan`, `output`, `session`, `all`.

**Scripts location:** `$PR/scripts/`, reached via `{PR_BOOTSTRAP}` (per `_shared.md` §Paths) plus its GATE-CRITICAL guard: `[ -z "$PR" ] && { echo "gorkhali: plugin dir not found under ~/.claude/plugins/cache/gorkhali — run /plugin to install; validation skipped"; exit 0; }` (the validate scripts ARE the skill; empty `$PR` aborts readable, never `$PR/scripts/...` with an empty `$PR`)

---

<validation_coordination>

## Coordinator Role (Main LLM)

You are the coordinator. You do NOT run validation scripts directly. Instead:

1. **Parse $ARGUMENTS** to determine which layer(s): `plan`, `output`, `session`, or `all`
2. **Resolve paths**: session board JSON path (`${GORKHALI_DATA:-~/.gorkhali}/repos/{REPO_NAME}/sessions/{TICKET}.json`), project root
3. **Spawn an Inspector agent** to execute the validation scripts and collect results
4. **Present findings** to the user with pass/fail summary and actionable items

</validation_coordination>

<ward_agent>

## Inspector Agent Dispatch

Spawn a single **Inspector** agent for all requested layers. Inspector runs scripts sequentially and returns structured findings.

**Agent configuration:**
- subagent_type: `inspector` (effort = session `high`; model per `reference/agents.md` → Model Routing)
- name: `inspector-yarnell`
- mode: `bypassPermissions`
- If only one layer requested, Inspector runs that layer's script. For `all`, Inspector runs all three in sequence.

**Inspector prompt must include:**
- The specific layer(s) to validate
- Full script paths and arguments (from the table below)
- The session JSON path and project root
- Instructions to return structured JSON: `{ layer: string, passed: boolean, findings: string[] }[]`

</ward_agent>

<validation_layers>

## Validation Layer Reference

Pass these to Inspector's prompt so it knows what to run and what each script checks.

### Layer: `plan`

```bash
$PR/scripts/validate-plan.sh "${GORKHALI_DATA:-$HOME/.gorkhali}/repos/{REPO_NAME}/sessions/{TICKET}.json"
```

Checks: phase order (Auditor -> Inspector -> Auditor (gauntlet mode) -> User Feedback), user-verification inclusion for UI/Figma tasks, file ownership conflicts, task assignees, phase owners.

### Layer: `output`

```bash
$PR/scripts/validate-output.sh <agent-name> "<file1>,<file2>" /path/to/project
```

Checks: file ownership violations, copyright headers, inline hex/px values, barrel exports, filename conventions.

### Layer: `session`

```bash
$PR/scripts/validate-session.sh "${GORKHALI_DATA:-$HOME/.gorkhali}/repos/{REPO_NAME}/sessions/{TICKET}.json"
```

Checks: required fields, phase/task status enums, verification block after verify phase, user-verification block when user verification is required, loop count bounds, board JSON freshness.

### Layer: `all`

Inspector runs all three scripts in sequence (`plan` → `output` → `session`). Returns combined findings.

</validation_layers>

<results_presentation>

## Presenting Results

After Inspector returns, the coordinator:

1. Parse Inspector's structured findings
2. Show a summary table: layer | status (PASS/FAIL) | finding count
3. List each finding with severity and suggested fix
4. If all layers pass: confirm clean validation
5. If any layer fails: highlight blockers and suggest next action (fix, re-run specific layer)

</results_presentation>

---

## Automatic Validation (built into execution flow)

- **PreToolUse hook** on Agent calls validates model tier (denies fable on engineer/steward/inspector/surveyor/clerk), that engineer spawns carry an explicit model, and that the spawn's `name:` matches a roster-defined shape (`reference/roster.md`, `hooks/engineer-model-gate.js`) - it does not validate `mode`, `run_in_background`, or prompt content. BLOCKs bad spawns automatically.
- **Chief** runs `validate-plan.sh` before Phase C execution starts.
- **Chief** runs `validate-output.sh` after each agent completes (with that agent's owned files).
- **Chief** runs `validate-session.sh` at phase transitions and after verify/fix loops.
