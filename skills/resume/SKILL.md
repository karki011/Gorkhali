---
name: resume
description: Continue PREVIOUS work from a paused or prior session using its saved state and plan; NOT for new scope (start) or fresh execution (execute).
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/resume.md) is the single menu surface and stays user-invocable so typed /gorkhali:resume works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Resume, restore, or continue prior Gorkhali work from a paused session or earlier context using its saved state and plan.

Apply `../../host-support/compatibility.md` for workflow `resume` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/resume.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
