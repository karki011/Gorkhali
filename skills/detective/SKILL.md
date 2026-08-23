---
name: detective
description: Investigate an UNKNOWN cause behind a bug or regression and produce a forensic report; NOT for known failures (use fix).
---
## Triggers

Investigate unknown causes of bugs, regressions, wrong behavior, and mysterious failures, producing a forensic report without guessing at fixes. Use when something is off, started after a change, or has no clear error; use fix for known failures.

Apply `../../host-support/compatibility.md` for workflow `detective` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/detective.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
