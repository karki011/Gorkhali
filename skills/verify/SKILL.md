---
name: verify
description: Run the repository's correctness checks (tests, build, lint) and report results; NOT to repair known failures (use fix).
---
## Triggers

Run correctness checks for a Phantom workflow, including tests, builds, and lint; use when asked to verify changes, run tests, check the build, lint, or confirm the build is green, not to repair known failures.

Apply `../../codex-support/codex-compatibility.md` for workflow `verify` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/verify.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
