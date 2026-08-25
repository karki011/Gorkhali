---
name: review
description: Independent read-only review of the current verified diff for quality, duplication, and architecture; NOT for test runs (verify) or self-quizzing (grill).
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/review.md) is the single menu surface and stays user-invocable so typed /gorkhali:review works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Review current code changes for quality, simplicity, duplication, architecture, and actionable diff findings; not for test execution or requirements validation.

Apply `../../host-support/compatibility.md` for workflow `review` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/review.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
