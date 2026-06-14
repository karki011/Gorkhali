---
name: phantom:review
description: "Use when you want a CODE review of current changes — quality, KISS/DRY, architecture, a second opinion on the diff. Spawns Gaze for KISS/DRY enforcement, architecture review, and simplification gauntlet. Also use when user says 'review my changes', 'review my code', 'code review this', 'second opinion on this code', or 'is this code quality good'. NOT for test/build checks (use phantom:verify) or requirements coverage (use phantom:validate)."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T3** — loads '_shared.md' + '_shared-shadows.md' + '_shared-discipline.md' + '_shared-contracts.md'

# /phantom:review

Trigger Gaze quality gate on current work.

1. Load current session's contracts and handoff notes

**Codebase-wide review → recommend a workflow.** For a large-diff or repo-wide pre-PR review,
recommend running the sweep as a Claude Code dynamic workflow per
`reference/workflow-delegation.md`: independent agents cross-check and filter findings before they
reach context (READ-ONLY — "Audit and REPORT only — do not modify files"). Fall back to
turn-by-turn review for normal-sized diffs or when workflows are unavailable.

2. Spawn Gaze (`subagent_type: "gaze"`, `mode: "bypassPermissions"`) with: (effort = session `high`; model per `reference/agents.md` → Model Routing)
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
