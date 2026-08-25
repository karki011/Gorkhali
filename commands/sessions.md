---
name: sessions
description: "Use when you want to see past work — list sessions, check history, find one to resume. Read-only: status (active/paused/completed), dates, ticket IDs. Continuing a session → gorkhali:resume."
# Hidden from the Claude Code / menu to deduplicate entries — the same-named skill is the single menu surface and delegates to this command, which remains the canonical procedure. Do not flip without re-checking menu duplication.
user-invocable: false
---

> **Preamble Tier: T1** — loads `_shared.md` only (canonical registry: `scripts/preamble-tier.js`)

# /gorkhali:sessions

List all ticket folders in `sessions/`. For each, read session files and show:

- **ACTIVE** -> **PAUSED** -> **COMPLETED**
- Include contract status (complete/incomplete) for each session
