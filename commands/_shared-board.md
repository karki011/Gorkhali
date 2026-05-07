# Phantom Works Crew -- Event Log Context

> Loaded by commands that interact with session state. Always load `_shared.md` first.

---

## Data Layout

Event-sourced architecture — task events are the source of truth.

```
~/.claude/team/
  events/                           # NDJSON event logs (append-only)
    {REPO_NAME}/
      task-events.ndjson            # Raw TaskCreate/TaskUpdate events
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

### How data flows

1. **`TaskCreate`/`TaskUpdate`** fires → `board-event-log.js` hook appends raw event to `events/{REPO}/task-events.ndjson`
2. **Session boundaries** detected by `[Cortex] SESSION:start` markers or temporal gaps (>30 min)
3. **Crew roster** parsed from `[CrewName]` prefixes in task subjects

### Where to write what

| Data | Write to | Who writes |
|------|----------|------------|
| Task events | `events/{REPO}/task-events.ndjson` | board-event-log.js hook (append-only) |
| Contracts | `sessions/{TICKET}/contracts/` | `team:contract` |
| Decisions | `sessions/{TICKET}/decisions.md` | Manual |
