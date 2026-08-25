---
name: health
description: Diagnose the Gorkhali SYSTEM ITSELF - stale learnings index, corrupted sessions, missing artifacts; NOT for broken user code (use fix or detective).
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/health.md) is the single menu surface and stays user-invocable so typed /gorkhali:health works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Diagnose Gorkhali knowledge-system integrity, including stale learnings, corrupted sessions, missing artifacts, broken edges, and index drift. Use when Gorkhali itself seems broken or when asked to check or diagnose Gorkhali health.

Apply `../../host-support/compatibility.md` for workflow `health` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/health.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
