---
name: team:review
description: "Use when you want a code review, quality check, or second opinion on current changes. Spawns Prism for KISS/DRY enforcement, architecture review, and simplification gauntlet. Also use when user says 'review this', 'check my code', 'is this good', or 'code quality'."
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-crew.md' + '_shared-superpowers.md' + '_shared-contracts.md'

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
