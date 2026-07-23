---
name: fix
description: Repair a known failed verification step inside an active Phantom session, then re-verify within the controlled fix loop. Use for known failing tests, builds, lint, or CI; use hound when the cause is unknown.
---
Apply `../../codex-support/codex-compatibility.md` for workflow `fix` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/fix.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
