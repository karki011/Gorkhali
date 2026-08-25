---
name: sessions
description: "Use when you want to see past work — list sessions, check history, find one to resume. Read-only: status (active/paused/completed), dates, ticket IDs. Continuing a session → gorkhali:resume."
# User-invocable (default) - typed /gorkhali:sessions resolves here. The same-named skill (skills/sessions/SKILL.md) carries user-invocable: false to stay off the / menu; this command remains the canonical procedure and the single menu surface. Do not flip without re-checking menu duplication.
---

> **Preamble Tier: T1** — loads `_shared.md` only (canonical registry: `scripts/preamble-tier.js`)

# /gorkhali:sessions

List all ticket folders in `sessions/`. For each, read session files and show:

- **ACTIVE** -> **PAUSED** -> **COMPLETED**
- Include contract status (complete/incomplete) for each session
