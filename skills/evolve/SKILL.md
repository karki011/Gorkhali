---
name: evolve
description: "Maintain Gorkhali's knowledge system: distill oversized learnings, promote validated patterns, and clean stale entries."
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/evolve.md) is the single menu surface and stays user-invocable so typed /gorkhali:evolve works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Maintain Gorkhali knowledge by distilling oversized learnings, cleaning stale entries, and promoting validated patterns globally. Use for learning cleanup, pattern promotion, knowledge maintenance, or system evolution.

Apply `../../host-support/compatibility.md` for workflow `evolve` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/evolve.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
