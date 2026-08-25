---
name: verify
description: Run the repository's correctness checks (tests, build, lint) and report results; NOT to repair known failures (use fix).
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/verify.md) is the single menu surface and stays user-invocable so typed /gorkhali:verify works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Run correctness checks for a Gorkhali workflow, including tests, builds, and lint; use when asked to verify changes, run tests, check the build, lint, or confirm the build is green, not to repair known failures.

Apply `../../host-support/compatibility.md` for workflow `verify` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/verify.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
