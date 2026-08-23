---
name: sessions
description: "Use when you want to see past work — list sessions, check history, find one to resume. Read-only: status (active/paused/completed), dates, ticket IDs. Continuing a session → phantom:resume."
---

> **Preamble Tier: T1** — loads `_shared.md` only (canonical registry: `scripts/preamble-tier.js`)

# /phantom:sessions

List all ticket folders in `sessions/`. For each, read session files and show:

- **ACTIVE** -> **PAUSED** -> **COMPLETED**
- Include contract status (complete/incomplete) for each session
