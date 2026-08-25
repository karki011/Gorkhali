---
name: fix
description: Repair a KNOWN failing check (test/build/lint/CI) inside an active session; NOT for cold-start fixes (start) or unknown causes (detective).
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/fix.md) is the single menu surface and stays user-invocable so typed /gorkhali:fix works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Repair a known failed verification step inside an active Gorkhali session, then re-verify within the controlled fix loop. Use for known failing tests, builds, lint, or CI; use detective when the cause is unknown.

Apply `../../host-support/compatibility.md` for workflow `fix` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/fix.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
