---
name: phantom:fix
description: "Use when verification failed, tests broke, build errors occurred, lint issues found, or CI is red — and the root cause is known or narrowed down. Also use when user says 'fix it', 'it's broken', 'tests failing', 'build failed', 'errors', 'something broke', or 'make it pass'. NOT for investigation — use phantom:hound when you need to find the cause first. Triages failures, assigns scoped repairs, re-verifies. Max 3 loops."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md` + `_shared-auto-learning.md`

# /phantom:fix

Fix loop from latest failed verification.

<instructions>

Mode: if `$ARGUMENTS` contains `--chained`, this is CHAINED flow; otherwise STANDALONE (default, gated).

1. **Load failures** — from `verification.json` or session JSON. **BLOCK if none** (run `/phantom:verify` first).
2. **Check loop count** — if >= 3, go to structured escalation (step 8).
3. **Debugging discipline** — reproduce → trace → confirm root cause BEFORE fixing. If loop 2+, trigger hound deep investigation (step 3.5).

**3.5. Hound escalation (loop 2+ only):** Same failure class repeating → full 7-step investigation per `reference/detective/protocol.md`. Produces `investigation.html`. Feed hypothesis into step 7 (scrap-and-redo).

4. **Triage** — spawn triage agent (`subagent_type: "gaze"`, `mode: "bypassPermissions"`): classify failures (build/type/contract/ui/test/etc.), create fix packet with assigned owners. (model + effort come from the agent definition)
5. Show fix packet. **CHAINED (`--chained` present) → AUTO-PROCEED past approval (the max-3 loop + step-9 exhaustion escalation is the safety net). STANDALONE (token absent) → wait for user approval.**
6. Activate blade marker: `touch ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing`
7. Spawn scoped repair Blade(s) (`subagent_type: "blade"`, `mode: "bypassPermissions"`) → deactivate marker (`rm -f ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing`) → re-verify: CHAINED → `Skill(skill="phantom:verify", args="--chained")` (keeps the loop autonomous); STANDALONE → `Skill(skill="phantom:verify")` (no args).
8. **If re-verify passes** → exit, proceed to wrap.
   **If fails:** same class → scrap-and-redo (step 8.5) + write correction. Different class → increment loop, return to step 1.

**8.5. Scrap-and-redo:** Document what was learned. `git checkout -- <touched files>`. Spawn fresh agent with synthesized learnings (not failed code). Re-verify.

9. **Structured escalation** (loop > 3 or scope expanded):
   ```
   ## FIX LOOP EXHAUSTED ({N}/3)
   ### What was attempted (per-loop summary)
   ### Root cause hypothesis
   ### Options: A) Pivot  B) Reduce scope  C) Accept as-is  D) Abandon
   ```
   Wait for user response.

</instructions>
