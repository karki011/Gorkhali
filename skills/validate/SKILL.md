---
name: validate
description: Retroactively audit a finished session's outputs against its plan and contracts; NOT for code quality (review) or test runs (verify).
---
## Triggers

Retroactively audit a finished Phantom session for plan completeness and contract or requirements coverage; use for validating sessions, checking outputs against contracts, or confirming all requirements were covered, not for code review or test runs.

Apply `../../codex-support/codex-compatibility.md` for workflow `validate` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/validate.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
