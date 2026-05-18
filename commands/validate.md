---
name: team:validate
description: Run validation checks (plan/output/session/all)
argument-hint: "[layer]"
---

> **Preamble Tier: T2** — loads '_shared.md' + '_shared-repo-detection.md' + '_shared-auto-learning.md'

# /team:validate $ARGUMENTS

Run validation scripts to check crew guidance compliance. Layers: `plan`, `output`, `session`, `all`.

**Scripts location:** `~/.claude/team/scripts/`

---

## /team:validate plan

Validates the session JSON plan before execution:

```bash
~/.claude/team/scripts/validate-plan.sh ~/.claude/team/repos/{REPO_NAME}/state/sessions/{TICKET}.json
```

Checks: phase order (Prism -> Sentinel -> Prism (gauntlet mode) -> Lens -> User Feedback), Lens inclusion for UI/Figma tasks, file ownership conflicts, task assignees, phase owners.

---

## /team:validate output <agent-name> <owned-files>

Validates agent output after completion:

```bash
~/.claude/team/scripts/validate-output.sh <agent-name> "<file1>,<file2>" /path/to/project
```

Checks: file ownership violations, copyright headers, inline hex/px values, barrel exports, filename conventions.

---

## /team:validate session

Validates session JSON integrity at checkpoints:

```bash
~/.claude/team/scripts/validate-session.sh ~/.claude/team/repos/{REPO_NAME}/state/sessions/{TICKET}.json
```

Checks: required fields, phase/task status enums, verification block after verify phase, visual verification block when visualVerify: true, loop count bounds, board JSON freshness.

---

## /team:validate all

Runs all three validators in sequence. Summarizes combined results.

---

## Automatic Validation (built into execution flow)

- **PreToolUse hook** on Agent calls validates `mode: "bypassPermissions"`, `run_in_background: true`, model tier, and prompt content. BLOCKs bad spawns automatically.
- **Cortex** runs `validate-plan.sh` before Phase C execution starts.
- **Cortex** runs `validate-output.sh` after each agent completes (with that agent's owned files).
- **Cortex** runs `validate-session.sh` at phase transitions and after verify/fix loops.
