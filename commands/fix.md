---
name: team:fix
description: "Use when verification failed, tests broke, build errors occurred, or lint issues found. Triages failures, assigns scoped repairs, re-verifies. Max 3 loops."
---

> Load `_shared.md` + `_shared-crew.md` + `_shared-contracts.md` + `_shared-board.md` + `_shared-superpowers.md` before executing.

# /team:fix

Start a fix loop from the latest failed verification.

1. Load `verification` from session state -- **BLOCK if no failures recorded** (must run `/team:verify` first)
2. Check loop count -- if >= 3, escalate to user instead of running
3. **Debugging discipline**: Call `Skill(skill="superpowers:systematic-debugging")` before Cortex (triage) triages. Enforce root-cause investigation --
   read error messages completely, check recent changes (git diff from last passing state), trace data flow to SOURCE not symptom.
   Form single hypothesis, test minimally, one variable at a time. **3+ fixes on same issue -> STOP, question architecture, escalate.**
4. Spawn **Cortex (triage)** (model: sonnet) to:
   - Read failure details from session JSON
   - Classify each failure (build/type/contract/ui/a11y/test/performance/docs/integration)
   - Create fix packet with assigned owners and scoped repairs
5. Show fix packet to user for approval
6. On approval:
   a. Update board with fix loop task
   b. Spawn only the assigned repair agents (scoped to failing files only)
   c. After repairs complete, automatically run `/team:verify`
7. If re-verify passes -> exit loop, proceed to wrap
8. If re-verify fails:
   a. Compare failure class to previous iteration's failure class
   b. If SAME class → trigger re-plan (step 10) — do NOT increment loop
   c. If DIFFERENT class → increment loop counter, repeat from step 1
   d. Write correction for the failed approach (Trigger 2 from auto-learning)
9. **Correction format** (when writing corrections on repeated failure in step 8):
   Format: `CORRECTION [{approach-keyword}]: [{what went wrong}] — [{what to do instead}] [failed] ({date})`
   Include approach signature so future anti-repetition gate can pattern-match.
   Example: `CORRECTION [_groupHover in Popover]: hover state unreliable on portal content — use kebab menu or controlled open state [failed] (2026-04-10)`

10. **Re-plan on repeated failure** (no patch stacking):
    Before each fix iteration (step 8), compare current failure class to ALL previous iterations (not just N-1):
    
    ```
    IF fix_loop.iteration >= 2 AND current_failure_class IN previous_failure_classes:
      LOG "[FIX] Failure class '{failure_class}' seen before. Patch approach exhausted."
      WRITE correction to learnings/{domain}.md
      ESCALATE to re-plan (Phase B) with failure history
      EXIT fix loop
    ```
    
    This catches cycling patterns (A→B→A) that comparing only N-1 would miss.

11. **Other escalation triggers:**
    - Loop count > 3 (hard cap — present structured escalation from step 11)
    - 3+ fix attempts on same root cause without resolution (architectural problem signal — see `superpowers:systematic-debugging`)
    - Contract must change to fix (return to contract phase)
    - Scope expanded beyond original failure (return to planning)
    - User says "stop", "this isn't working", or expresses frustration → STOP immediately, present options

12. **Structured escalation** (when loop count > 3 or 3+ attempts on same root cause):
    Present to user in this exact format:
    ```
    ## FIX LOOP EXHAUSTED ({N}/3)

    ### What was attempted
    1. Loop 1: [{approach}] → [{result}]
    2. Loop 2: [{approach}] → [{result}]
    3. Loop 3: [{approach}] → [{result}]

    ### Root cause hypothesis
    [{Cortex's best theory based on all 3 attempts}]

    ### Options
    A. **Pivot approach**: [{describe specific alternative not yet tried}]
    B. **Reduce scope**: [{what to cut to make remaining work pass}]
    C. **Accept as-is**: [{what remains broken, impact assessment}]
    D. **Abandon**: [{roll back to last known good state}]

    Choose A/B/C/D or provide direction:
    ```
    Do NOT continue without user response. This is a hard gate.
