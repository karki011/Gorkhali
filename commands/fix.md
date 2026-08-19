---
name: fix
description: "Use when verification just failed inside an active phantom session — tests broke, build failed, lint issues, or CI went red and the failing step is known. Repairs a KNOWN failure; it does not start net-new work. Also use when user says 'fix the failing test', 'tests failing', 'build failed', or 'make it pass'. NOT for cold-start 'fix X' requests (those route to phantom:start) and NOT for unknown causes (use phantom:detective to investigate first). Triages failures, assigns scoped repairs, re-verifies. Loop ceiling owned by hooks/loop-controller.js."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md` + `_shared-auto-learning.md`

# /phantom:fix

Fix loop from latest failed verification.

> **Loop authority:** the attempt count, the hard stop, and the same-finding-class
> escalation are OWNED by `hooks/loop-controller.js`, NOT by this prose. The ceiling
> (`FIX_LOOP_CEILING`, sourced from `scripts/lib/constants.js`; env override
> `PHANTOM_FIX_LOOP_CEILING`) is not restated here. The controller counts from the
> review round ledger `{SESSION_DIR}/reviews/rounds.json` — how many times the
> reviewed worktree fingerprint CHANGED between consecutive rounds, so
> re-reviewing an unchanged diff adds a round but not an attempt, while step
> 8.5's revert-and-retry still counts as the two attempts it is — falling back to
> legacy `verification.json`
> `review.fixLoops` only for pre-portable sessions. The ONLY way past the
> ceiling is the controller's explicit, logged operator override (a NEW narrower
> problem surfaced — genuine progress, not patch-stacking), recorded at
> `verification.json` `review.override` and honoured by both the CLI below and
> `hooks/fix-loop-gate.js`.

<instructions>

Mode: if `$ARGUMENTS` contains `--chained`, this is CHAINED flow; otherwise STANDALONE (default, gated).

1. **Load failures** — from `verification.json` or session JSON. **BLOCK if none** (run `/phantom:verify` first).
2. **Check loop count** — read the standing the ledger already holds:

   ```text
   {PR_BOOTSTRAP}
   [ -z "$PR" ] && { echo "phantom: plugin dir not found under ~/.claude/plugins/cache/phantom — run /plugin to install"; exit 0; }
   node "$PR/scripts/review-round.js" status --reviews {SESSION_DIR}/reviews --session {SESSION_DIR} --json
   ```

   Its `loop` object is `hooks/loop-controller.js` `shouldContinue()` applied to
   the recorded rounds, with this session's operator override already folded in
   (that is what `--session` supplies). `loop.decision.escalate` → structured
   escalation (step 9).

   Two shapes are NOT permission to continue, and neither is an escalation:
   `loop: null` (the controller could not be loaded) and `loop.fixLoops: null`
   with `source: "unknown"` (the ledger could not be read — unknown, never zero).
   Report the standing as-is and get the state readable before opening a loop.
3. **Debugging discipline** — reproduce (pipe the failing command through `scripts/lib/log-capture.js --label fix-repro` for a bounded summary; set `set -o pipefail` and read the captured `$?` before the pipe — `log-capture.js` always exits 0, so without pipefail a still-failing repro looks fixed) → trace → confirm root cause BEFORE fixing. If loop 2+, trigger detective deep investigation (step 3.5).

**3.5. Detective escalation (loop 2+ only):** Same failure class repeating → full 7-step investigation per `reference/detective/protocol.md`. Produces `investigation.html`. Feed hypothesis into step 7 (scrap-and-redo).

4. **Triage** — spawn triage agent (`subagent_type: "auditor"`, `name: "auditor-ledgard"`, `mode: "bypassPermissions"`): classify failures (build/type/contract/ui/test/etc.) and write the ordered fix packet with assigned owners to `{SESSION_DIR}/fix-packet.json`. (effort = session `high`; model per `reference/agents.md` → Model Routing)
5. Show fix packet. **CHAINED (`--chained` present) → AUTO-PROCEED past approval (the loop ceiling + step-9 exhaustion escalation is the safety net). STANDALONE (token absent) → wait for user approval.**
6. Per-spawn Engineer lifecycle state is owned by validated hooks.
7. Spawn scoped repair Engineer(s) (`subagent_type: "engineer"`, `name:` per `reference/roster.md`'s reserved fix-packet range (its Spawn-Site Slot Table `fix.md` row), assigned in the order each owner entry appears in `{SESSION_DIR}/fix-packet.json`, `mode: "bypassPermissions"`) → re-verify: CHAINED → `Skill(skill="phantom:verify", args="--chained")` (keeps the loop autonomous); STANDALONE → `Skill(skill="phantom:verify")` (no args).
8. **If re-verify passes** → exit, proceed to wrap.
   **If fails:** same class → scrap-and-redo (step 8.5) + write correction. Different class → increment loop, return to step 1.

**8.5. Scrap-and-redo:** Document what was learned. `git checkout -- <touched files>`. Spawn fresh agent (`subagent_type: "engineer"`, `name: "engineer-redo-{N}"` per `reference/roster.md`'s Scrap-and-Redo rule - never reuse the failed attempt's original name, `mode: "bypassPermissions"`) with synthesized learnings (not failed code). Re-verify.

9. **Structured escalation** (controller `shouldContinue` returns stop — at ceiling with no operator override, or scope expanded). `{CEILING}` = the controller's `FIX_LOOP_CEILING`:
   ```
   ## FIX LOOP EXHAUSTED ({N}/{CEILING})
   ### What was attempted (per-loop summary)
   ### Root cause hypothesis
   ### Options: A) Pivot  B) Reduce scope  C) Accept as-is  D) Abandon
   ```
   Wait for user response.

</instructions>
