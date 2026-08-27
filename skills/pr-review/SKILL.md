---
name: pr-review
description: "Review someone else's PR against ticket, GitHub issue, or PR-body intent. Advisory. Will not post unless you ask. Never records a lifecycle gate. NOT for your verified local diff (review) or shipping a PR (wrap)."
---
## Triggers

Review someone else's pull request against its stated intent (Jira/Linear ticket, GitHub issue, or PR body). Checks reachability in production, then correctness. Advisory only; never records a lifecycle gate; drafts a comment and does not post unless asked. Wrong surface: YOUR verified diff → `review`; opening YOUR PR → `wrap`.

Apply `../../host-support/compatibility.md` for workflow `pr-review` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/pr-review.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
