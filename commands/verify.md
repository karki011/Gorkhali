---
name: phantom:verify
description: "Use to RUN correctness checks — execute the tests, build, and lint and observe whether they pass. Also use when user says 'run the tests', 'does it pass', 'check the build', 'lint it', 'run verification', or 'is the build green'. NOT for repairing a known failure (use phantom:fix), code-quality review (use phantom:review), or requirements coverage (use phantom:validate). Runs correctness checks (lint + build + tests) then a power level for quality."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:verify

Three-step verification: correctness commands → power level → auto-address.

<instructions>

Mode: if `$ARGUMENTS` contains `--chained`, this is CHAINED flow; otherwise STANDALONE (default, gated).

## Step 1: Correctness (commands, no agents)

Discover verify commands from repo (see `_shared-repo-detection.md` protocol, `reference/verification.md` for tier precedence).

Run each command piped through `scripts/lib/log-capture.js --label <command>` and read the bounded summary it returns. **`log-capture.js` always exits 0** (it fails open so a capture bug never hides the real output), so a bare pipe makes `$?` reflect the capture script, not your command — a red lint/build/test would read as green. Enable `set -o pipefail` first and capture the wrapped command's status, mirroring the snippet documented in `log-capture.js`'s header:

```sh
set -o pipefail
pnpm test 2>&1 | node scripts/lib/log-capture.js --label test
test_status=$?
```

Judge pass/fail on the captured status (non-zero = fail), not on the pipe's default exit code. Grep the full log at the path in the hint line for anything the summary trimmed. Report one line per command as `<command>: pass` or `<command>: fail`, then close with the pre-computed aggregate — `count: N of M commands passed` — never leave the reader to tally the lines above themselves.

If ANY fail → run hound failure scan (Step 1.5), name every failing command explicitly (never a bare "failed"). **CHAINED (`--chained` present) → auto-invoke `Skill(skill="phantom:fix", args="--chained")`. STANDALONE (token absent) → report the failures, close with `help[1]:\n  Run /phantom:fix to repair the failing command(s) named above`, and stop.**

Spawn sweep agent (`subagent_type: "sweep"`, `mode: "bypassPermissions"`) on changed files using `agents/sweep.md`. If changes produced → re-run correctness. (effort = session `high`; model per `reference/agents.md` → Model Routing)

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

If `[]` → state the empty result definitively, with its scope: `review: 0 P0/P1 findings (gaze against git diff main...HEAD)` — skip Step 3 and proceed to Step 4 (visual). A non-empty array is reported the same way — `review: N P0/P1 findings` — with each finding named below it, not just the count.

## Step 3: Auto-Address (only if P0/P1 exist)

1. Spawn 1 fix agent (`subagent_type: "blade"`, `mode: "bypassPermissions"`) with scoped findings
2. Re-run Step 1 correctness only
3. Re-review ONLY the fix diff
4. Loop until the fix-loop ceiling (`FIX_LOOP_CEILING` from `scripts/lib/constants.js`, enforced by `hooks/loop-controller.js`; protocol: `reference/temperature-review.md`). Clean → pass. Still P0/P1 → escalate to user.

## Step 4: Visual Verification (auto — UI changes only)

If `HAS_UI = true` (per `_shared-repo-detection.md`) AND `git diff --name-only main...HEAD` touches UI files, a browser agent must confirm the change actually renders before anything ships — correctness commands don't catch visual regressions.

- **CHAINED (`--chained` present)** → auto-invoke `Skill(skill="phantom:visual", args="--autonomous")`. Lens drives a real browser: screenshots the affected routes across viewports/states, compares against intent/Figma, and runs its own ≤3-iteration fix loop. Do not wait for the human.
- **STANDALONE (token absent)** → `Skill(skill="phantom:visual")` (interactive: shows results, asks before fixing).

Fold Lens's outcome into the verdict and record it in `visualVerification` (verification.json): resolved → pass; `partial`/unresolved after the loop ceiling → escalate, do not silently pass. State the outcome definitively either way — `visual: resolved (N route(s)/viewport(s) checked)` or `visual: partial — <what's still wrong>` — never a bare "done". Skip (and note why, e.g. `visual: skipped — no UI files changed`) only when `HAS_UI = false`, no UI files changed, or `agent-browser` is unavailable (per `phantom:visual` step 3).

</instructions>

## Write Artifact

Write `{TEAM_DIR}/sessions/{TICKET}/verification.json`. Schema in `reference/schemas/verification.md`.

Key fields: `_meta`, `correctness` (lint/build/tests/commands), `review` (temperature/findings/fixLoops), `simplifyRan`, `intentAlignment`, `verdict`, `score`.

## Result

- **PASS** → print the definitive verdict — `verdict: pass`, the Step 1 `count: N of M commands passed`, and `review: 0 P0/P1 findings` (or the resolved fix-loop count if Step 3 ran) — then proceed to `/phantom:wrap`. A self-contained pass needs no `help[N]:` block.
- **FAIL** → name every failing command and finding explicitly (never a bare "failed"), then close with `help[1]:\n  Run /phantom:fix to repair the failures named above`. **CHAINED (`--chained` present) → auto-invoke `Skill(skill="phantom:fix", args="--chained")` (do not wait for the human). STANDALONE (token absent) → report + the help block above, and stop.**
