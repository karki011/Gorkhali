---
name: status
description: "Use when you want to check progress or get a status update - 'what are we working on', 'where are we'. The one notification surface: what is running, what is blocked on you, what shipped."
user-invocable: true
---

# /status

The single place to re-read where a session stands. Reads the session folder only - no git, no tracker calls, nothing outward-facing.

<instructions>
1. Find the active session via `lib/session.js`'s `activeSession`. None - say so and stop.
2. Read `plan.json` and `progress.json` for it (via `lib/session.js`).
3. Show, in plain English:
   - **Session** - repo, task, current phase.
   - **Running** - tasks dispatched in `progress.json` with no matching completion entry yet.
   - **Blocked on you** - a plan gate awaiting approval, or a wiring notification not yet acknowledged. This is the one place such a decision can always be re-read; it is not the only place it is ever shown - `start.md` and `resume.md` print it inline too, at the moment it arises.
   - **Shipped** - tasks `progress.json` marks done.
4. Show which preferences layer is in force (`lib/preferences.js`: repo, global, or none), from `_shared.md`'s User Preferences section, so it is clear what is steering the agents right now.
</instructions>
