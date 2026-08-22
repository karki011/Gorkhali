---
name: scout
description: Explore the codebase to map dependencies and gather context before planning; NOT for implementation (use start).
---
## Triggers

Explore the codebase before planning to understand an implementation, map dependencies, find related code, or gather established patterns without implementing.

Apply `../../host-support/compatibility.md` for workflow `scout` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/scout.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
