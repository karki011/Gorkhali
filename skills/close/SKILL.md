---
name: close
description: "Post-merge ticket closeout: move Jira to Done, archive the session, clean up branch/worktree, record cost; NOT for shipping a PR (use wrap)."
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/close.md) is the single menu surface and stays user-invocable so typed /gorkhali:close works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Complete post-merge ticket closeout by finalizing Jira and session state, archiving artifacts, recording cost, and cleaning the branch or worktree. Use after a PR merges or when asked to close, archive, or clean up a finished ticket.

Apply `../../host-support/compatibility.md` for workflow `close` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/close.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
