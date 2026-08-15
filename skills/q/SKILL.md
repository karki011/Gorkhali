---
name: q
description: "Alias of loop: start the Mission Control queue loop from any session."
---
## Triggers

Start the Phantom Mission Control queue loop; alias for phantom:loop when the user invokes q or requests the queue.

Apply `../../codex-support/codex-compatibility.md` for workflow `q` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/q.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
