---
name: team:fix
description: Start fix loop from latest failed verification
---

> Load `_shared.md` + `_shared-crew.md` + `_shared-contracts.md` + `_shared-superpowers.md` before executing.

# /team:fix

Start a fix loop from the latest failed verification.

1. Load `verification` from session state -- **BLOCK if no failures recorded** (must run `/team:verify` first)
2. Check loop count -- if >= 3, escalate to user instead of running
3. **Debugging discipline** (`superpowers:systematic-debugging`): Before Kureha triages, enforce root-cause investigation --
   read error messages completely, check recent changes (git diff from last passing state), trace data flow to SOURCE not symptom.
   Form single hypothesis, test minimally, one variable at a time. **3+ fixes on same issue -> STOP, question architecture, escalate.**
4. Spawn **Kureha** (model: sonnet, persona from `.claude/agents/kureha.md`) to:
   - Read failure details from session JSON
   - Classify each failure (build/type/contract/ui/a11y/test/performance/docs/integration)
   - Create fix packet with assigned owners and scoped repairs
5. Show fix packet to user for approval
6. On approval:
   a. Update board with fix loop task
   b. Spawn only the assigned repair agents (scoped to failing files only)
   c. After repairs complete, automatically run `/team:verify`
7. If re-verify passes -> exit loop, proceed to wrap
8. If re-verify fails -> increment loop, repeat from step 1
9. **Escalation triggers:**
   - Loop count > 3
   - Same failure repeated twice (also writes correction to relevant `learnings/{domain}.md` under `## Corrections`)
   - 3+ fix attempts on same root cause without resolution (architectural problem signal -- see `superpowers:systematic-debugging`)
   - Contract must change to fix (return to contract phase)
   - Scope expanded beyond original failure (return to planning)
