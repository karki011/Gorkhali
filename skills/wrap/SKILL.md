---
name: wrap
description: "Ship completed work: verify, create a ready-for-review PR, and record the release/lifecycle outcome; NOT for post-merge steps (use close)."
---
## Triggers

Finish and ship completed Phantom work by enforcing verification, finalizing the session, recording learnings, committing and pushing, and creating a pull request; use for wrap up, ship it, create PR, finalize, or submit work.

Apply `../../codex-support/codex-compatibility.md` for workflow `wrap` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/wrap.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
