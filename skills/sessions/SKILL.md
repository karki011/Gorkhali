---
name: sessions
description: List and inspect past Gorkhali sessions - status, dates, tickets - read-only; NOT to continue one (use resume).
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/sessions.md) is the single menu surface and stays user-invocable so typed /gorkhali:sessions works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

List and inspect past Gorkhali sessions, statuses, dates, tickets, contracts, and history to find work that may be resumed.

Apply `../../host-support/compatibility.md` for workflow `sessions` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/sessions.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
