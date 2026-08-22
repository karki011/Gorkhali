---
name: resume
description: Continue PREVIOUS work from a paused or prior session using its saved state and plan; NOT for new scope (start) or fresh execution (execute).
---
## Triggers

Resume, restore, or continue prior Phantom work from a paused session or earlier context using its saved state and plan.

Apply `../../host-support/compatibility.md` for workflow `resume` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/resume.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
