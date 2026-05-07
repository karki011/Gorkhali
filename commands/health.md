---
name: team:health
description: Diagnose knowledge layer health and report issues
---

> Load `_shared.md` (core only).

# /team:health

Validate knowledge layer integrity for the current repo. Reports issues but does NOT auto-fix (user decides).

## Checks

1. **Stale entries** — scan `learnings/INDEX.md` for entries older than 60 days without a `[validated:N]` counter increment. Report as `STALE: [{entry}] last validated {date}`.

2. **Missing lifecycle tags** — scan `learnings/INDEX.md` for entries without `[proposed]`, `[validated:N]`, or `[failed]` tags. Report as `UNTAGGED: [{entry}]`.

3. **Contradiction detection** — scan each domain file for Pattern + Correction entries referencing the same concept/approach without a `supersedes` edge in `EDGES.md`. Report as `CONTRADICTION: [{pattern}] vs [{correction}] — needs supersedes edge`.

4. **Orphaned sessions** — check `sessions/` directories against event log entries in `~/.claude/team/events/{REPO}/task-events.ndjson`. Report sessions with dirs but no events as `ORPHANED: sessions/{TICKET}`.

5. **INDEX sync** — compare entries in each `learnings/{domain}.md` against `learnings/INDEX.md`. Report entries in domain files missing from INDEX as `DESYNC: [{entry}] in {domain}.md but not in INDEX.md`.

6. **Decision staleness** — scan `decisions/global.md` for `Active` decisions older than 90 days. Report as `STALE DECISION: [{decision}] active since {date} — consider revalidation`.

7. **Edge integrity** — if `EDGES.md` exists, check that all Source and Target IDs reference entries that still exist in INDEX.md or domain files. Report broken refs as `BROKEN EDGE: [{source}] → [{target}] — target not found`.

8. **Global promotion candidates** — scan INDEX.md for entries with `[validated:5+]` that are NOT in `~/.claude/team/global/patterns/INDEX.md`. Report as `PROMOTE?: [{entry}] validated {N} times — consider global promotion`.

## Output Format

```
## Knowledge Health Report — {REPO_NAME}
Date: {date}

### Summary
- {N} stale entries
- {N} untagged entries
- {N} contradictions
- {N} orphaned sessions
- {N} INDEX desyncs
- {N} stale decisions
- {N} broken edges
- {N} promotion candidates

### Issues
{grouped by check type, one line per issue}

### Recommended Actions
{prioritized list: fix contradictions first, then desyncs, then stale cleanup}
```

If all checks pass: report `Knowledge layer healthy. {N} entries, {N} edges, {N} decisions tracked.`
