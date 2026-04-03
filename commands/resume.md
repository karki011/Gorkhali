---
name: team:resume
description: Resume a paused/wrapped session
argument-hint: "[ticket-or-slug]"
---

> Load `_shared.md` + `_shared-crew.md` + `_shared-contracts.md` before executing.

# /team:resume $ARGUMENTS

1. Load `state/sessions/{TICKET}.json` for phase progress
2. Read all session files from `sessions/{ticket}/` for full context
3. Load `sessions/{ticket}/contracts/` for active contracts
4. Load `decisions/global.md` (cross-cutting decisions only)
5. Load `sessions/{ticket}/decisions.md` (feature-specific decisions)
6. Load `learnings/INDEX.md` (always) + `learnings/crew.md` (always) + domain-specific files based on ticket context (ui.md, data.md, auth.md, testing.md, migration.md, tooling.md)
7. Re-spawn same team with same mapping + handoff notes + contracts

**Decision loading rule**: NEVER load decisions from other tickets. Only `global.md` + current ticket's `decisions.md`.
