---
name: visual
description: Prepare a human UI-verification checklist for UI changes; optionally run read-only Phantom Surveyor inspection only when explicitly requested.
---
## Triggers

Prepare a human UI-verification checklist, or run optional read-only Phantom Surveyor inspection when the user explicitly requests Surveyor; user confirmation remains authoritative.

Apply `../../host-support/compatibility.md` for workflow `visual` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/visual.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `phantom:<x>` operations to the corresponding plugin skill.

Return confirmed routes and observations only when the user explicitly passes
the checklist. Non-UI work does not invoke this skill; verification records the
compact `{ "required": false }` decision without user interaction.

Do not invoke Surveyor unless the user explicitly requests it. Surveyor evidence is
advisory and never replaces the checklist confirmation or becomes a ship gate.
