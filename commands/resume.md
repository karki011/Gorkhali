---
name: team:resume
description: "Use when continuing previous work, picking up where left off, or resuming a paused session. Restores full context, contracts, and learnings."
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

### Resuming Forked Sessions

If the previous session used `--fork-session` for exploration:
1. Check `state/sessions/{TICKET}/forks/` for fork results
2. If both forks completed → present comparison to user, let them choose
3. If one fork is incomplete → offer to continue it or abandon
4. Load the chosen fork's state as the active session

```bash
# Resume a specific fork
claude --resume {fork-session-id}
```
