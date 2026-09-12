---
name: resume
description: Recover interrupted work, reconcile Git and pending operations, and continue the approved scope.
allowed-tools: ["Agent", "Read", "Write", "Bash", "Grep", "Glob"]
user-invocable: true
---

# Resume

Read `_shared.md` and call CLI `resume`. A session needs a readable plan; when
missing, list available sessions and request the intended task.

The result contains current and previous state. An unchanged fingerprint and
unchanged approved plan continue automatically from `next`, without re-approval.
Changed HEAD, index, worktree, branch, or untracked content invalidates verification.
Inspect the intervening diff and task dependency/ownership changes. Ask for a new
plan decision only when divergence materially changes approved scope/dependencies.
Legacy sessions reconstruct a checkpoint but their old verification is always stale.

Before restarting a wave, reconcile `activeEngineers`, saved completion records,
and `integration.json` against Git. A pending cherry-pick is a blocked integration,
not a fresh task. `integrate` recognizes committed source markers after a crash;
never blindly dispatch an already-integrated task. Preserve dirty work for recovery.
A PR created before a checkpoint is recovered by `ship`'s existing-PR lookup.

Persist the reconciled next transition and blockers through `progress`. If a
phase is uncertain, report that uncertainty instead of guessing completion.
