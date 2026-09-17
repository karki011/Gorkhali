---
name: close
description: After human merge, close the session and safely clean up task resources.
allowed-tools: ["Read", "Write", "Bash", "Agent"]
user-invocable: true
---

# Close

Read `../references/lifecycle.md`; call CLI `close` with the PR number. It requires the session's exact shipped PR URL to be MERGED, records
the merge, and begins ticket completion before releasing the session. Follow
`../references/tracking.md`: if `needsTracking` is true, complete the pending `done`
stage and call `close` again. A failed ticket update keeps the session recoverable.
Only a completed close allows optional cleanup; no-ticket work needs no tracker calls.
Remove only this task's merged feature branch. Preserve dirty
or uncertain resources and report them. Never delete the default branch or another
task's work. Keep the session artifacts for recovery and report the merge commit.
