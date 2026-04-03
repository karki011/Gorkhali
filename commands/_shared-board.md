# Straw Hat Engineering Crew -- Board Context

> Loaded by commands that interact with board state. Always load `_shared.md` first.

---

## Data Layout

Event-sourced architecture — zero translation between Claude tasks and the board.

```
~/.claude/team/
  board-app/                        # Board UI (Vite + Hono)
  events/                           # NDJSON event logs (append-only)
    {REPO_NAME}/
      task-events.ndjson            # Raw TaskCreate/TaskUpdate events
  story/                            # GLOBAL Captain's Log (cross-repo)
    index.md
    chapter-*.md
  repos/
    {REPO_NAME}/
      sessions/{TICKET}/            # SESSION DETAILS (human-readable)
        contracts/                  #   feature.md / api.md / testing.md / ui.md
        decisions.md                #   Feature-specific decisions
        *.md                        #   Session log files
      decisions/global.md           # Cross-cutting decisions
      learnings/
        INDEX.md                    # Always loaded — one-liner per entry
        ui.md / data.md / auth.md   # Domain files (## Patterns / ## Corrections / ## Habits)
        testing.md / crew.md        # Loaded on-demand by task domain
        migration.md / tooling.md
```

### How data flows (zero translation)

1. **`TaskCreate`/`TaskUpdate`** fires → `board-event-log.js` hook appends raw event to `events/{REPO}/task-events.ndjson`
2. **Board server** reads NDJSON, materializes sessions/tasks on-the-fly
3. **SSE** broadcasts new events to connected clients in real-time
4. **Session boundaries** detected by `[Luffy] SESSION:start` markers or temporal gaps (>30 min)
5. **Crew roster** parsed from `[CrewName]` prefixes in task subjects by the board UI

### Where to write what

| Data | Write to | Who writes | Board reads? |
|------|----------|------------|--------------|
| Task events | `events/{REPO}/task-events.ndjson` | board-event-log.js hook (append-only) | YES |
| Contracts | `sessions/{TICKET}/contracts/` | `team:contract` | via /api/contracts |
| Decisions | `sessions/{TICKET}/decisions.md` | Manual | No |

**No session JSON needed.** Board materializes sessions from the event log. No sync, no translation, no drift.
