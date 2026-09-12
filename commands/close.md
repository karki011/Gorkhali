---
name: close
description: After human merge, close the session and safely clean up task resources.
allowed-tools: ["Read", "Write", "Bash", "Agent"]
user-invocable: true
---

# Close

Read `../references/lifecycle.md`; call CLI `close` with the PR number. It requires the session's exact shipped PR URL to be MERGED, records
completion, and releases the active session before optional cleanup. Then use the
configured tracker adapter to mark done if authorized; none is a no-op.
Remove only task-owned clean worktrees and merged feature branches. Preserve dirty
or uncertain resources and report them. Never delete the default branch or another
task's work. Keep the session artifacts for recovery and report the merge commit.
