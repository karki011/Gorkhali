---
name: loop
description: "Run one Mission Control pass over ready Jira tickets, triaging and dispatching or planning each; alias: q."
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/loop.md) is the single menu surface and stays user-invocable so typed /gorkhali:loop works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Run one Mission Control pass over ready Jira tickets, triaging and dispatching solid work or planning ambiguous work; supports read-only status checks.

Apply `../../host-support/compatibility.md` for workflow `loop` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/loop.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
