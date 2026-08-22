---
name: close
description: "Post-merge ticket closeout: move Jira to Done, archive the session, clean up branch/worktree, record cost; NOT for shipping a PR (use wrap)."
---
## Triggers

Complete post-merge ticket closeout by finalizing Jira and session state, archiving artifacts, recording cost, and cleaning the branch or worktree. Use after a PR merges or when asked to close, archive, or clean up a finished ticket.

Apply `../../host-support/compatibility.md` for workflow `close` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/close.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
