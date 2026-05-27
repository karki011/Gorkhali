# Phantom Shadows -- Event Log Context

**Event flow:** TaskCreate/TaskUpdate → board-event-log.js hook → `events/{repo}/task-events.ndjson`

**Session boundary:** Temporal gap > 30 min between events = new session.

**Shadows roster:** Parsed from `[CrewName]` prefixes in task subjects.

**Write targets:** Events → NDJSON. Contracts → sessions/{TICKET}/contracts/. Decisions → manual. Learnings → domain files.
