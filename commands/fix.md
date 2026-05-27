---
name: phantom:fix
description: "Use when verification failed, tests broke, build errors occurred, lint issues found, or CI is red — and the root cause is known or narrowed down. Also use when user says 'fix it', 'it's broken', 'tests failing', 'build failed', 'errors', 'something broke', or 'make it pass'. NOT for investigation — use phantom:hound when you need to find the cause first. Triages failures, assigns scoped repairs, re-verifies. Max 3 loops."
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md` + `_shared-auto-learning.md`

# /phantom:fix

Fix loop from latest failed verification.

<instructions>

1. **Load failures** — read from `state/sessions/{TICKET}/verification.json` if present, else fall back to session JSON. **BLOCK if no failures recorded** (must run `/phantom:verify` first).
2. **Check loop count** — if >= 3, go straight to structured escalation (step 10).
3. **Debugging discipline** — reproduce issue, trace exact code path, confirm root cause BEFORE writing any fix. Never stack patches on a wrong hypothesis. If loop 2+, trigger hound escalation (step 3.5).
3.5. **Hound escalation (loop 2+ only)** — if this is the 2nd+ attempt with the same failure class, trigger deep investigation before retrying (see below).
4. **Triage** — spawn **Apex** (model: sonnet) to:
   - Read failure details from the loaded artifact
   - Classify each failure (build/type/contract/ui/a11y/test/performance/docs/integration)
   - Create fix packet with assigned owners and scoped repairs
5. Show fix packet to user for approval.
6. On approval:
   - Update board with fix loop task
   - Spawn only the assigned repair agents (scoped to failing files)
   - After repairs, call `Skill(skill="phantom:verify")` — verify handles power level internally
7. If re-verify passes → exit loop, proceed to wrap.
8. If re-verify fails:
   - Compare failure class to **all** previous iterations (not just N-1)
   - SAME class → scrap-and-redo (step 9), write correction, exit loop
   - DIFFERENT class → increment loop counter, return to step 1
   - Write correction: `CORRECTION [{keyword}]: [{wrong}] — [{right}] [failed] ({date})`

<detective_deep_investigation>

8.5. **Hound deep investigation** (same failure class on loop 2+):
   The previous approach failed. Before scrap-and-redo, gather forensic evidence.
   
   Load `_shared-hound.md` context. Run full 7-step investigation:
   1. Collect all error messages from both failed attempts
   2. Timeline: `git log --oneline --since="2.weeks"` on failing files
   3. Hotspot analysis on failing files (change frequency × complexity)
   4. Ownership check (`git shortlog -sn`) — is this a knowledge silo?
   5. Coupling check — did a coupled file miss a co-change?
   6. Hypothesis with confidence level
   7. Evidence trail (specific commits, line numbers)
   
   Write `state/sessions/{TICKET}/investigation.html` using template from `reference/hound-protocol.md`.
   
   Feed hypothesis and evidence into step 9 (scrap-and-redo) — the fresh agent gets the forensic report, not just "try again."

</detective_deep_investigation>

<scrap_and_redo>

9. **Scrap-and-redo** (patch approach exhausted):
   - **Synthesize** — agent documents what was learned: edge cases, real API behavior, why approaches failed
   - **Revert** — `git checkout -- <all files touched by fix attempts>`
   - **Rebuild** — spawn fresh agent: "You tried [X] and [Y], which failed because [Z]. Knowing this, implement the elegant solution from scratch." Pass synthesized learnings, not failed code.
   - **Verify** — run `phantom:verify` on fresh implementation

</scrap_and_redo>

<constraints>

10. **Escalation triggers**: loop > 3, contract must change, scope expanded, user says stop.
11. **Structured escalation** format:
    ```
    ## FIX LOOP EXHAUSTED ({N}/3)

    ### What was attempted
    1. Loop 1: [{approach}] → [{result}]
    2. Loop 2: [{approach}] → [{result}]
    3. Loop 3: [{approach}] → [{result}]

    ### Root cause hypothesis
    [{Apex's best theory based on all 3 attempts}]

    ### Options
    A. **Pivot approach**: [{specific alternative not yet tried}]
    B. **Reduce scope**: [{what to cut to make remaining work pass}]
    C. **Accept as-is**: [{what remains broken, impact assessment}]
    D. **Abandon**: [{roll back to last known good state}]

    Choose A/B/C/D or provide direction:
    ```
    Wait for user response before continuing.

</constraints>

</instructions>
