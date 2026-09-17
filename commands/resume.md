---
name: resume
description: Recover interrupted work, reconcile Git and pending operations, and continue the approved scope.
allowed-tools: ["Agent", "Read", "Write", "Bash", "Grep", "Glob"]
user-invocable: true
---

# Resume

Read `../references/lifecycle.md` and call CLI `resume`. A session needs a readable plan; when
missing, list available sessions and request the intended task.

Read the returned `tracking` state and follow `../references/tracking.md`. Reuse
the saved ticket/no-ticket decision and successful stage receipts. Complete pending
updates by reading the provider before retrying; never replay assignment, an earlier
status, or a PR-link comment blindly. Report tracker errors and ask for missing
workflow/access information. Legacy sessions without a decision ask the ticket question once.

The result contains current and previous state.
An unchanged fingerprint and unchanged approved plan continue automatically from `next`, without re-approval.
For autonomous work preserve `approval.baseHead` and the original allowance.
Recompute stale scope classifications before another dispatch or repair when the
raw diff reaches the limit; never obtain a fresh autonomous allowance for an amendment.
Commits an active Engineer made on top of its own dispatched base, on the same dispatched branch and checkout, are reported as in-progress work (`branchWork: true`, next `result`), not divergence; collect its result normally.
A branch or checkout switch away from the dispatched checkout is never `branchWork`, even at the same commit; it is divergence like any other.
Any other changed HEAD, index, worktree, branch, or untracked content invalidates verification.
Inspect the intervening diff and task dependency/ownership changes.
Call `reconcile` with the scope classification and concrete Git evidence; dispatch, repair, integration, and verification stay blocked until reconciliation.
Ask for a new plan decision only when divergence materially changes approved scope/dependencies.
A non-done result with leftover commits or dirty files requires the same reconcile step before recover, and the reconcile reason separately reports whether the leftover commits and the leftover dirty files each stay within the task's declared ownership.
Reconcile only records the scope decision; it never discards or commits leftover dirty files itself.
When dirty files remain after reconciling, raise one decision to the user: either discard the listed files or commit them under the task's declared files, and only then call `recover`.
The lead never merges, force-removes, or commits those files itself, and `dispatch`/`recover` keep rejecting a dirty integration tree.
Legacy sessions reconstruct a checkpoint but their old verification is always stale.

Before dispatching again, reconcile `activeEngineers`, saved completion records, and `integration.json` against Git.
A completion whose commits are already on the integration branch but not yet journaled is a pending integration, not a fresh task; `integrate` recognizes it after a crash.
Never blindly dispatch an already-integrated task.
Preserve dirty work for recovery.
A PR created before a checkpoint is recovered by `ship`'s existing-PR lookup.

Explicitly selecting a task reactivates that session for subsequent commands.
Current task and dependency hashes determine completed work, never task IDs alone.
Persist agent outcomes with `result` and any remaining blockers through `progress`.
If a phase is uncertain, report that uncertainty instead of guessing completion.
