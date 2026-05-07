---
name: team:review
description: Trigger Prism quality gate on current work
---

> Load `_shared.md` + `_shared-crew.md` before executing.

# /team:review

Trigger Prism quality gate on current work.

1. Load current session's contracts and handoff notes
2. Spawn Prism (model: opus, subagent_type: reviewer) with:
   - All files touched in this session
   - Active contracts
   - Repo rules from `.claude/rules/`
3. Prism produces:
   - CRITICAL / WARNING / INFO findings
   - VERDICT: APPROVED or NEEDS WORK
   - Specific file:line references
4. Record verdict in session state
5. If NEEDS WORK: list specific items to address

For high-risk work, run Prism (gauntlet mode) instead (simplify -> Prism review -> full verify).
