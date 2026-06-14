---
name: phantom:status
description: "Use when you want to see what's happening, check progress, view the task board, or get a status update on current work. Shows active session, running agents, task progress, and pending items. Also use when user says 'what are we working on', 'show progress', 'where are we', or 'task list'."
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /phantom:status

Task board from `{TEAM_DIR}/sessions/{TICKET}.json`. Show:

- Agent assignments and status (pending/active/done)
- Contract completion status
- Verification results
- Open blockers
- AI cost so far: self-resolve the plugin dir then run `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; [ -n "$PR" ] && node "$PR/scripts/cost-report.js" {TICKET}` and show its `Total:` line (skip silently if it fails or if `$PR` is empty — no plugin cache; telemetry batches ~60s so the figure may trail slightly)
