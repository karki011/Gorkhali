---
name: recruit
description: Spawn a specialized one-off Engineer agent (implementation, research, audit, accessibility, security) outside the normal session flow.
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/recruit.md) is the single menu surface and stays user-invocable so typed /gorkhali:recruit works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Recruit or spawn a specialized Engineer agent for a focused implementation, research, audit, accessibility, performance, security, or other one-off role.

Apply `../../host-support/compatibility.md` for workflow `recruit` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/recruit.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
