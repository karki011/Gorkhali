---
name: eval
description: Score a finished session's agent performance, coordination, and outcome quality against a rubric.
---
## Triggers

Evaluate agent performance and session quality with rubric-based scores for outputs, coordination, verification, and outcomes. Use to rate the work, score a session, review shadow effectiveness, or assess how a run went.

Apply `../../host-support/compatibility.md` for workflow `eval` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/eval.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
