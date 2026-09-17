---
name: wrap
description: Ship current verified work to a PR and own its bounded external review loop. Human merge only.
allowed-tools: ["Agent", "Read", "Write", "Bash", "Grep", "Glob"]
user-invocable: true
---

# Wrap

Read `../references/lifecycle.md`. Wrap owns the single verification pass. Call CLI
`verify` first; when it reports missing or stale evidence, run the `verify`
procedure now, once, on the final integrated commit, then continue. No extra
standalone review artifact exists. Version bumps and commits happen through
Engineer before this verification, never afterward. Bump manifests consistently:
major for removed public contracts, minor for compatible features, patch for
fixes. Re-verify if any change is still needed.

Write a concise PR title/body grounded in the approved requirement, actual behavior,
checks, Auditor findings, and known limitations. Confirm ship authorization from
the user's request or plan approval, for example "approved, take it to a PR", and
ask only if absent. Call `ship` with that authorization and
title/body. It requires a clean feature branch and current passed evidence, reuses
an existing open PR on resume, or pushes and creates a ready-for-review PR.
Checkpoint the PR result; `ship` returns `{url}`.
Every Engineer committed on the integration branch, so there are no worktrees to release.
Uncommitted content in the integration tree bypassed ownership, completion, Inspector, and Auditor; `ship` refuses a dirty tree, so surface that content and never merge or force-remove it.
Raise it as one user decision: discard it, or amend the plan so an Engineer commits it through the normal path before re-verification.
When the dirt is generated output the repository does not ignore, propose the ignore rule instead of a discard.
Follow `../references/tracking.md` to complete the pending
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
