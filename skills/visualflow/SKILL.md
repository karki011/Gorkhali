---
name: visualflow
description: Plan a NEW screen or flow as a reviewable HTML artifact before writing code, especially with no Figma design.
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/visualflow.md) is the single menu surface and stays user-invocable so typed /gorkhali:visualflow works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Plan a new UI screen, feature, or user flow before implementation by producing a human-approved HTML flow artifact; use for visual flows, screen planning, low-fidelity wireframes, or net-new UI without a Figma design.

Apply `../../host-support/compatibility.md` for workflow `visualflow` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/visualflow.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.
