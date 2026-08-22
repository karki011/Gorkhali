---
name: pause
description: Checkpoint and save in-progress session state before a break, with no git operations; NOT for shipping (use wrap).
---
## Triggers

Pause, checkpoint, or save in-progress Phantom session state before a meeting, context switch, or break without performing git operations.

Apply `../../host-support/compatibility.md` for workflow `pause` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/pause.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
