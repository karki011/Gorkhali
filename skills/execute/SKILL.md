---
name: execute
description: Run an already approved Phantom plan by loading its contracts and intent, dispatching its agents, and executing its waves. Use to run or execute an approved plan; use start for unplanned work and resume for prior sessions.
---
Apply `../../codex-support/codex-compatibility.md` for workflow `execute` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/execute.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
