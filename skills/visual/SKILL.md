---
name: visual
description: Prepare a human UI-verification checklist for UI changes; optionally run read-only Gorkhali Surveyor inspection only when explicitly requested.
# Hidden from the Claude Code / menu via user-invocable: false - the same-named command (commands/visual.md) is the single menu surface and stays user-invocable so typed /gorkhali:visual works. Claude's Skill tool can still invoke this skill; user-invocable: false only blocks direct typing, not model invocation. Do not flip without re-checking menu duplication.
user-invocable: false
---
## Triggers

Prepare a human UI-verification checklist, or run optional read-only Gorkhali Surveyor inspection when the user explicitly requests Surveyor; user confirmation remains authoritative.

Apply `../../host-support/compatibility.md` for workflow `visual` before reading the delegated command. It resolves the portable runtime, loads the canonical preambles, then identifies `../../commands/visual.md`.

Treat all invocation text as `$ARGUMENTS` and follow the resolved command as the canonical procedure. Translate Claude-specific tool names to the current host's equivalents while preserving every gate and artifact. Route chained `gorkhali:<x>` operations to the corresponding plugin skill.

Return confirmed routes and observations only when the user explicitly passes
the checklist. Non-UI work does not invoke this skill; verification records the
compact `{ "required": false }` decision without user interaction.

Do not invoke Surveyor unless the user explicitly requests it. Surveyor evidence is
advisory and never replaces the checklist confirmation or becomes a ship gate.
