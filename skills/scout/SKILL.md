---
name: scout
description: Explore the codebase to map dependencies and gather context before planning; NOT for implementation (use start).
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/scout.md) is the single menu surface and stays user-invocable so typed /gorkhali:scout works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Explore the codebase before planning to understand an implementation, map dependencies, find related code, or gather established patterns without implementing.

Apply `../../host-support/compatibility.md` for workflow `scout` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/scout.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
