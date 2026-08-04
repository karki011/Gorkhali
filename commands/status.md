---
name: status
description: "Use when you want to see what's happening, check progress, view the task board, or get a status update on current work. Shows active session, running agents, task progress, and pending items. Also use when user says 'what are we working on', 'show progress', 'where are we', or 'task list'."
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /phantom:status $ARGUMENTS

Task board from `{TEAM_DIR}/sessions/{TICKET}.json`. Fields: `assignments`, `contracts`, `verification`, `blockers`, `cost` — default is all five. `--fields a,b` in `$ARGUMENTS` narrows to just those; validate first (self-resolve `$PR` per `_shared.md`): `[ -f "$PR/scripts/lib/fields.js" ] && node "$PR/scripts/lib/fields.js" parse "<fields>" --valid assignments,contracts,verification,blockers,cost` — an unknown name reports the error and stops instead of rendering; a missing `scripts/lib/fields.js` in `$PR` (empty `$PR` or stale cache) skips validation and shows all five. Show:

- **assignments** — Agent assignments and status (pending/active/done)
- **contracts** — Contract completion status
- **verification** — Verification results
- **blockers** — Open blockers
- **cost** — AI cost so far: self-resolve the plugin dir then run `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -n "$PR" ] && node "$PR/scripts/cost-report.js" {TICKET}` and show its `Total:` line (skip silently if it fails or if `$PR` is empty — no plugin cache; telemetry batches ~60s so the figure may trail slightly)
