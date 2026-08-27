---
name: wrap
description: "Ship completed work: validate passed verification+review, write the author brief, open a ready-for-review PR, then capability-gate the external review loop; NOT for post-merge (use close) or reviewing someone else's PR (use pr-review)."
---
## Triggers

Finish and ship completed Gorkhali work by validating current verification and review evidence, writing the author defense brief, committing and pushing, and creating a pull request; use for wrap up, ship it, create PR, finalize, or submit work. Wrap does not run Auditor. `review` reviews YOUR verified diff; `pr-review` reviews someone else's PR.

Wrong surface: this is not `/gorkhali:review` (needs Inspector on this worktree) and not `/gorkhali:pr-review` (foreign PR, advisory).

Apply `../../host-support/compatibility.md` for workflow `wrap` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/wrap.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
