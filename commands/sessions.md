---
name: phantom:sessions
description: "Use when you want to see past work, list previous sessions, check session history, or find a specific session to resume. Read-only — just lists sessions with their status (active/paused/completed), dates, and ticket IDs. Also use when user says 'list sessions', 'session history', 'show my sessions', 'what sessions do I have', 'what was I working on', 'what did we do before', 'show history', 'past sessions', or 'find session'. NOT to continue a session — use phantom:resume."
---

> **Preamble Tier: T1** — loads '_shared.md' only

# /phantom:sessions

List all ticket folders in `sessions/`. For each, read session files and show:

- **ACTIVE** -> **PAUSED** -> **COMPLETED**
- Include contract status (complete/incomplete) for each session
