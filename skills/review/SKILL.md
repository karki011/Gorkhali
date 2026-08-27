---
name: review
description: Independent read-only review of YOUR verified local diff; gates the ship. NOT for someone else's PR (pr-review), test runs (verify), wrap/ship, or self-quizzing (grill).
---
## Triggers

Review YOUR current verified diff for quality, simplicity, duplication, architecture, and actionable findings. Requires a passed Inspector artifact bound to this worktree. Wrong surface: someone else's PR → `pr-review`; opening a PR → `wrap`; running tests → `verify`.

Apply `../../host-support/compatibility.md` for workflow `review` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/review.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
