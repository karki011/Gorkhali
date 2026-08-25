---
name: learn
description: Record a correction, reusable pattern, habit, or gotcha for Gorkhali to remember in future sessions.
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/learn.md) is the single menu surface and stays user-invocable so typed /gorkhali:learn works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Record corrections, reusable patterns, habits, gotchas, or anything the user asks Gorkhali to remember for future sessions.

Apply `../../host-support/compatibility.md` for workflow `learn` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/learn.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
