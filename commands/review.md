---
name: review
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

2. Delete `{SESSION_DIR}/reviews/gaze.json` if it exists, then spawn Gaze (`subagent_type: "gaze"`, `name: "gaze-ombric"`, `mode: "bypassPermissions"`) with: (effort = session `high`; model per `reference/agents.md` → Model Routing)
   - All files touched in this session
   - Active contracts
   - Repo rules from `.claude/rules/`

   That pre-spawn clear is the same one Apex does for the four panel role files in `reference/wrap/rpsl.md`, and it is load-bearing on a repeated review: step 4 below checks that the file is present and carries a `verdict`, it does not check freshness. A Gaze that truncates before rewriting the file leaves the previous run's verdict on disk, step 4 reads it as a satisfied review, skips the resume, and records an APPROVED produced against an earlier revision. The clear belongs to this caller rather than to `agents/gaze.md`: a truncated agent may never reach its own cleanup, which is the failure mode being defended against.
3. Gaze produces:
   - CRITICAL / WARNING / INFO findings
   - VERDICT: APPROVED or NEEDS WORK
   - Specific file:line references
4. Record the verdict in session state by reading the `verdict` field of `{SESSION_DIR}/reviews/gaze.json`, not by transcribing Gaze's final message: the artifact survives a truncated turn that destroys the message. If the file is absent or carries no verdict, give Gaze ONE `SendMessage` resume (by agent id or name, never a respawn), then record what is on disk; if it is still absent, record the verdict as `not_observed` rather than assuming APPROVED.
5. If NEEDS WORK: list specific items to address

For high-risk work, run Gaze (gauntlet mode) instead (simplify -> Gaze review -> full verify).
