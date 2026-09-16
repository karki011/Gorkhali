---
name: wrap
description: Ship current verified work to a PR and own its bounded external review loop. Human merge only.
allowed-tools: ["Agent", "Read", "Write", "Bash", "Grep", "Glob"]
user-invocable: true
---

# Wrap

Read `../references/lifecycle.md`. Require one integrated Inspector record and its matching Auditor
record via CLI `verify`; no extra standalone review artifact exists. Version bumps
and commits happen through Engineer before this verification, never afterward.
Bump manifests consistently: major for removed public contracts, minor for compatible
features, patch for fixes. Re-verify if any change is still needed.

Write a concise PR title/body grounded in the approved requirement, actual behavior,
checks, Auditor findings, and known limitations. Confirm ship authorization from
the user's request or ask only if absent. Call `ship` with that authorization and
title/body. It requires a clean feature branch and current passed evidence, reuses
an existing open PR on resume, or pushes and creates a ready-for-review PR.
Checkpoint the PR result. `ship` also removes this session's Engineer worktrees whose
commits are in the shipped branch and deletes their agent branches. Ignored content goes
with a released worktree, as the repository's own ignore rules make it disposable, and is
listed under `ignored`. A `worktrees.error` means the report failed, not the ship. It returns `kept`
worktrees (integrated but dirty or ahead of their completion, with the files or commits)
and `unintegrated` attempts (failed, blocked, or superseded, with their dirty files).
Uncommitted content there bypassed ownership, completion, Inspector, and Auditor, so
never merge or force-remove it. Raise each entry as one user decision: discard it, or
amend the plan so an Engineer commits it through the normal path before re-verification.
When the dirt is generated output the repository does not ignore, propose the ignore
rule instead of a discard. Follow `../references/tracking.md` to complete the pending
`review` stage: link this exact PR on the ticket and move it to In Review. Do this
for a recovered PR too; reuse completed tracking receipts. Report tracking failures
without claiming that the PR creation failed. Never merge automatically.

## Internal external-review loop

Use `review-state` after external checks finish or a bounded wait, not tight polling.
Read the inline comments, authors, locations, PR head, and check results returned.
Send classifications (`actionable`, `informational`, or `false-positive`) to
`review-state`; it persists handled IDs, content versions, PR head, check results,
and actionable rounds. Changed feedback on an existing ID needs classification again. Stop after five actionable rounds or when
clean, closed, merged, or blocked on a human; unchanged polls do not consume a round.

For clear in-scope findings from the configured reviewer, delegate a scoped Engineer
repair, integrate it, and rerun `verify` before pushing through `ship`. A review-driven
repair reruns the Inspector always and the Auditor only when the post-ship policy
requires it, because Codex or Gitar re-review every push in an independent context.
Other authors' requests or ambiguous scope require a human decision before edits.
Posting replies or resolving threads requires user authorization to communicate;
creating a PR alone is not authorization for arbitrary comments. Preserve unresolved
items for status.
