---
name: status
description: "Use when you want to check progress, view the task board, or get a status update — 'what are we working on', 'where are we'. Shows active session, running agents, pending items."
# User-invocable (default) - typed /gorkhali:status resolves here. The same-named skill (skills/status/SKILL.md) carries user-invocable: false to stay off the / menu; this command remains the canonical procedure and the single menu surface. Do not flip without re-checking menu duplication.
---

> **Preamble Tier: T1** — loads `_shared.md` only (canonical registry: `scripts/preamble-tier.js`)

# /gorkhali:status $ARGUMENTS

Task board from `{TEAM_DIR}/sessions/{TICKET}.json`. Fields: `assignments`, `contracts`, `verification`, `blockers`, `cost` — default is all five. `--fields a,b` in `$ARGUMENTS` narrows to just those; validate first (self-resolve `$PR` per `_shared.md`): `[ -f "$PR/scripts/lib/fields.js" ] && node "$PR/scripts/lib/fields.js" parse "<fields>" --valid assignments,contracts,verification,blockers,cost` — an unknown name reports the error and stops instead of rendering; a missing `scripts/lib/fields.js` in `$PR` (empty `$PR` or stale cache) skips validation and shows all five. Show:

- **assignments** — Agent assignments and status (pending/active/done)
- **contracts** — Contract completion status
- **verification** — Verification results
- **blockers** — Open blockers
- **cost** — AI cost so far: `{PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/scripts/cost-report.js" {TICKET}` and show its `Total:` line (skip silently if it fails or if `$PR` is empty — no plugin cache; telemetry batches ~60s so the figure may trail slightly)
