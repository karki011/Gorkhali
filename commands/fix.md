---
name: fix
description: "Use when verification just failed inside an active phantom session — tests broke, build failed, lint issues, or CI went red and the failing step is known. Repairs a KNOWN failure; it does not start net-new work. Also use when user says 'fix the failing test', 'tests failing', 'build failed', or 'make it pass'. NOT for cold-start 'fix X' requests (those route to phantom:start) and NOT for unknown causes (use phantom:hound to investigate first). Triages failures, assigns scoped repairs, re-verifies. Loop ceiling owned by hooks/loop-controller.js."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md` + `_shared-auto-learning.md`

# /phantom:fix

Fix loop from latest failed verification.

> **Loop authority:** the attempt count, the hard stop, and the same-finding-class
> escalation are OWNED by `hooks/loop-controller.js`, NOT by this prose. The ceiling
> (`FIX_LOOP_CEILING`, sourced from `scripts/lib/constants.js`; env override
> `PHANTOM_FIX_LOOP_CEILING`) is not restated here. The controller reads/writes
> the same counter as `verification.json` `review.fixLoops`. The ONLY way past the
> ceiling is the controller's explicit, logged operator override (a NEW narrower
> problem surfaced — genuine progress, not patch-stacking).

<instructions>

Mode: if `$ARGUMENTS` contains `--chained`, this is CHAINED flow; otherwise STANDALONE (default, gated).

1. **Load failures** — from `verification.json` or session JSON. **BLOCK if none** (run `/phantom:verify` first).
2. **Check loop count** — ask `hooks/loop-controller.js` (`shouldContinue`): at the ceiling and no operator override → structured escalation (step 8).
3. **Debugging discipline** — reproduce (pipe the failing command through `scripts/lib/log-capture.js --label fix-repro` for a bounded summary; set `set -o pipefail` and read the captured `$?` before the pipe — `log-capture.js` always exits 0, so without pipefail a still-failing repro looks fixed) → trace → confirm root cause BEFORE fixing. If loop 2+, trigger hound deep investigation (step 3.5).

**3.5. Hound escalation (loop 2+ only):** Same failure class repeating → full 7-step investigation per `reference/detective/protocol.md`. Produces `investigation.html`. Feed hypothesis into step 7 (scrap-and-redo).

4. **Triage** — spawn triage agent (`subagent_type: "gaze"`, `name: "gaze-elden"`, `mode: "bypassPermissions"`): classify failures (build/type/contract/ui/test/etc.) and write the ordered fix packet with assigned owners to `{SESSION_DIR}/fix-packet.json`. (effort = session `high`; model per `reference/agents.md` → Model Routing)
5. Show fix packet. **CHAINED (`--chained` present) → AUTO-PROCEED past approval (the loop ceiling + step-9 exhaustion escalation is the safety net). STANDALONE (token absent) → wait for user approval.**
6. Per-spawn Blade lifecycle state is owned by validated hooks.
7. Spawn scoped repair Blade(s) (`subagent_type: "blade"`, `name:` per `reference/roster.md`'s reserved fix-packet range (its Spawn-Site Slot Table `fix.md` row), assigned in the order each owner entry appears in `{SESSION_DIR}/fix-packet.json`, `mode: "bypassPermissions"`) → re-verify: CHAINED → `Skill(skill="phantom:verify", args="--chained")` (keeps the loop autonomous); STANDALONE → `Skill(skill="phantom:verify")` (no args).
8. **If re-verify passes** → exit, proceed to wrap.
   **If fails:** same class → scrap-and-redo (step 8.5) + write correction. Different class → increment loop, return to step 1.

**8.5. Scrap-and-redo:** Document what was learned. `git checkout -- <touched files>`. Spawn fresh agent (`subagent_type: "blade"`, `name: "blade-redo-{N}"` per `reference/roster.md`'s Scrap-and-Redo rule - never reuse the failed attempt's original name, `mode: "bypassPermissions"`) with synthesized learnings (not failed code). Re-verify.

9. **Structured escalation** (controller `shouldContinue` returns stop — at ceiling with no operator override, or scope expanded). `{CEILING}` = the controller's `FIX_LOOP_CEILING`:
   ```
   ## FIX LOOP EXHAUSTED ({N}/{CEILING})
   ### What was attempted (per-loop summary)
   ### Root cause hypothesis
   ### Options: A) Pivot  B) Reduce scope  C) Accept as-is  D) Abandon
   ```
   Wait for user response.

</instructions>
