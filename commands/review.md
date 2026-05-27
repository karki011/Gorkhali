---
name: phantom:review
description: "Use when you want a code review, quality check, or second opinion on current changes. Spawns Gaze for KISS/DRY enforcement, architecture review, and simplification gauntlet. Also use when user says 'review this', 'check my code', 'second opinion', 'is this good', or 'code quality'. NOT for test/build checks — use phantom:verify."
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-shadows.md' + '_shared-discipline.md' + '_shared-contracts.md'

# /phantom:review

Trigger Gaze quality gate on current work.

1. Load current session's contracts and handoff notes
2. Spawn Gaze (model: opus, subagent_type: reviewer) with:
   - All files touched in this session
   - Active contracts
   - Repo rules from `.claude/rules/`
3. Gaze produces:
   - CRITICAL / WARNING / INFO findings
   - VERDICT: APPROVED or NEEDS WORK
   - Specific file:line references
4. Record verdict in session state
5. If NEEDS WORK: list specific items to address

For high-risk work, run Gaze (gauntlet mode) instead (simplify -> Gaze review -> full verify).
