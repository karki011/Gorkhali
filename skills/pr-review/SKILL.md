---
name: pr-review
description: Review an external pull request against its ticket intent - resolves the PR, establishes intent from the Jira ticket or PR body, checks the change is reachable in production, then reviews correctness. Advisory only; never records a lifecycle gate and never posts to GitHub.
---
Apply `../../codex-support/codex-compatibility.md` for workflow `pr-review` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/pr-review.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
