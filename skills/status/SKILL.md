---
name: status
description: "Show current Gorkhali progress: active session, running agents, task board, and pending items."
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/status.md) is the single menu surface and stays user-invocable so typed /gorkhali:status works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Show current Gorkhali progress, active session, running agents, assignments, contracts, verification, blockers, task board, and cost.

Apply `../../host-support/compatibility.md` for workflow `status` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/status.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
