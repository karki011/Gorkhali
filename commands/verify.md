---
name: verify
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

Spawn sweep agent (`subagent_type: "sweep"`, `name: "sweep-nix"`, `mode: "bypassPermissions"`) on changed files using `agents/sweep.md`. If changes produced → re-run correctness. (effort = session `high`; model per `reference/agents.md` → Model Routing)

### Step 1.5: Hound Failure Scan (auto, on failure)

1. Extract failing file paths from output
2. Hotspot + coupling check on failing files (recipes from `_shared-hound.md`)
3. Recent changes: `git log --oneline --since="2.weeks" -- {failing_files}`
4. Add `hound` field to verification.json (schema in `reference/detective/depth-levels.md`)
5. Report: "{file} has {N} changes in 6mo, coupled with {other_file} (strength {S})"

## Step 2: Power Level (1 agent)

Delete `{SESSION_DIR}/reviews/gaze.json` if it exists, before spawning Gaze - the same pre-spawn clear Apex does for the four panel role files in `reference/wrap/rpsl.md`, and for the same reason. The clear is load-bearing on a re-run: the guard below checks that the file is present and carries a `findings` key, it does not check freshness. A Gaze that truncates before rewriting the file leaves the previous run's verdict in place, this step reads it as a satisfied review, skips the resume, and verification can print `review: 0 P0/P1 findings` against a diff nobody reviewed. Clear it again before each Step 3 re-review, which is another Gaze run on a changed diff. The clear belongs here and not in `agents/gaze.md`: a truncated agent may never reach its own cleanup, which is the failure mode being defended against.

Spawn ONE review agent (`subagent_type: "gaze"`, `name: "gaze-varel"`, `mode: "bypassPermissions"`):
- Input: `git diff main...HEAD` + intent from session
- Prompt: load from `reference/temperature-review.md` — "Review Agent Prompt" section
- Output: `{SESSION_DIR}/reviews/gaze.json`, whose `findings` key holds the P0/P1 array (P2/P3 dropped)

Read the findings from `reviews/gaze.json`, not from Gaze's final message: the file is the deliverable and survives a truncated turn that destroys the message. If the file is absent, unreadable, or carries no `findings` key, give Gaze ONE `SendMessage` resume (by agent id or name, never a respawn) asking it to write the artifact, then compute from what is on disk. That is the same resume-then-proceed guard as the Empty-Result Guard in `reference/wrap/rpsl.md`, and for the same reason: recover a lost deliverable without becoming a second gate that can wedge the session.

Three outcomes. They must not collapse into one another:

| On disk | Means | Report |
|---|---|---|
| `findings: []` | reviewed, genuinely clean | `review: 0 P0/P1 findings (gaze against git diff main...HEAD)` - definitive, with its scope. Skip Step 3, proceed to Step 4 (visual). |
| `findings` non-empty | N blockers | `review: N P0/P1 findings`, with each finding named below it, not just the count. Go to Step 3. |
| still absent after the one resume | not reviewed. Unknown, NOT zero | `review: not_observed - reviews/gaze.json absent after one resume`, reusing the `not_observed` vocabulary `reference/schemas/verification.md` already defines for correctness observations. Do not write an empty `review.findings`, and never print `review: 0 P0/P1 findings`. |

Only a written empty array earns the definitive empty-result line. Reporting an absent artifact as zero findings asserts a clean review nobody performed, which is precisely the lost-deliverable failure this artifact exists to prevent.

## Step 3: Auto-Address (only if P0/P1 exist)

1. Spawn 1 fix agent (`subagent_type: "blade"`, `name: "blade-talvik"`, `mode: "bypassPermissions"`) with scoped findings
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

- **PASS** → print the definitive verdict — `verdict: pass`, the Step 1 `count: N of M commands passed`, and `review: 0 P0/P1 findings` (or the resolved fix-loop count if Step 3 ran) — then proceed to `/phantom:wrap`. A self-contained pass needs no `help[N]:` block. Print the zero-findings line only for the Step 2 outcome that earns it, a `reviews/gaze.json` whose `findings` array was read and was empty; if Step 2 ended at `not_observed`, carry that label through and do not substitute a zero.
- **FAIL** → name every failing command and finding explicitly (never a bare "failed"), then close with `help[1]:\n  Run /phantom:fix to repair the failures named above`. **CHAINED (`--chained` present) → auto-invoke `Skill(skill="phantom:fix", args="--chained")` (do not wait for the human). STANDALONE (token absent) → report + the help block above, and stop.**
