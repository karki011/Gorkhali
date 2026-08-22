---
name: wire
description: Map dependency topology and wave ordering from an approved plan before execution.
---
## Triggers

Map dependency topology from an approved Phantom plan, including execution waves, integration points, ordering, shared files, and risks; use after plan approval or when asked to wire tasks or show implementation dependencies.

Apply `../../host-support/compatibility.md` for workflow `wire` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/wire.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.
