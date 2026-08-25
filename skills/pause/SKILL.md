---
name: pause
description: Checkpoint and save in-progress session state before a break, with no git operations; NOT for shipping (use wrap).
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/pause.md) is the single menu surface and stays user-invocable so typed /gorkhali:pause works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Pause, checkpoint, or save in-progress Gorkhali session state before a meeting, context switch, or break without performing git operations.

Apply `../../host-support/compatibility.md` for workflow `pause` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/pause.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
