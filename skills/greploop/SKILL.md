---
name: greploop
description: Iterate a pull request against ALL review comments (humans and bots), tag authors, resolve, then arm CHIEF_PING watch. Auto-invoked by wrap.
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/greploop.md) is the single menu surface and stays user-invocable so typed /gorkhali:greploop works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Iterate a pull request against all-author review (humans and bots), tagging the comment author and resolving threads, then arm a standing watch that pings Chief every tick including idle. Use to run Greploop, clear review feedback, or stand PR watch after wrap.

Apply `../../host-support/compatibility.md` for workflow `greploop` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/greploop.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
