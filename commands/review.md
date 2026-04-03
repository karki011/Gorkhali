---
name: team:review
description: Trigger Roger quality gate on current work
---

> Load `_shared.md` + `_shared-crew.md` before executing.

# /team:review

Trigger Roger quality gate on current work.

1. Load current session's contracts and handoff notes
2. Spawn Roger (model: opus, subagent_type: roger) with:
   - All files touched in this session
   - Active contracts
   - Repo rules from `.claude/rules/`
3. Roger produces:
   - CRITICAL / WARNING / INFO findings
   - VERDICT: APPROVED or NEEDS WORK
   - Specific file:line references
4. Record verdict in session state
5. If NEEDS WORK: list specific items to address

For high-risk work, run Sengoku instead (simplify -> Roger review -> full verify).
