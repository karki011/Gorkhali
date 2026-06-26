---
name: phantom:health
description: "Use when the Phantom SYSTEM ITSELF seems broken — learnings index is stale, sessions are corrupted, or artifacts are missing. Diagnoses the knowledge layer — checks learnings index, session state, edge files, and reports issues with fix suggestions. Also use when user says 'is phantom broken', 'is the phantom broken', 'phantom seems broken', 'check phantom health', or 'diagnose phantom'. NOT for broken user code (use phantom:fix for known failures, phantom:hound to investigate unknown ones)."
---

> **Preamble Tier: T1** — loads '_shared.md' only

# /phantom:health

Validate knowledge layer integrity for the current repo. Reports issues but does NOT auto-fix (user decides).

## Checks

1. **Stale entries** — scan `learnings/INDEX.md` for entries older than 60 days without a `[validated:N]` counter increment. Report as `STALE: [{entry}] last validated {date}`.

2. **Missing lifecycle tags** — scan `learnings/INDEX.md` for entries without `[proposed]`, `[validated:N]`, or `[failed]` tags. Report as `UNTAGGED: [{entry}]`.

3. **Contradiction detection** — scan each domain file for Pattern + Correction entries referencing the same concept/approach without a `supersedes` edge in `EDGES.md`. Report as `CONTRADICTION: [{pattern}] vs [{correction}] — needs supersedes edge`.

4. **Orphaned sessions** — scan `{TEAM_DIR}/sessions/` for session directories with no corresponding board file (`{TICKET}.json` missing) or an empty board with no activity (no tasks, no artifacts). Report as `ORPHANED: {TEAM_DIR}/sessions/{TICKET} — no board file / no activity`.

5. **INDEX sync** — compare entries in each `learnings/{domain}.md` against `learnings/INDEX.md`. Report entries in domain files missing from INDEX as `DESYNC: [{entry}] in {domain}.md but not in INDEX.md`.

6. **Decision staleness** — scan `decisions/global.md` for `Active` decisions older than 90 days. Report as `STALE DECISION: [{decision}] active since {date} — consider revalidation`.

7. **Edge integrity** — if `EDGES.md` exists, check that all Source and Target IDs reference entries that still exist in INDEX.md or domain files. Report broken refs as `BROKEN EDGE: [{source}] → [{target}] — target not found`.

8. **Global promotion candidates** — scan INDEX.md for entries with `[validated:5+]` that are NOT in `${PHANTOM_DATA:-~/.claude/phantom-data}/global/patterns/INDEX.md`. Report as `PROMOTE?: [{entry}] validated {N} times — consider global promotion`.

9. **File size caps**: Check all skill/reference/learnings files against caps:
   - `commands/*.md` (non-shared) > 80 lines → needs trimming
   - `reference/*.md` > 100 lines → needs distillation (EXCLUDE `*-template.md` — HTML templates are intentionally large, not prose to distill)
   - `learnings/INDEX.md` > 80 entries → needs pruning
   - `learnings/{domain}.md` > 50 entries → needs condensing
   Report oversized files. Remediation by class:
   - Oversized `commands/*.md` or `reference/*.md` → suggest a behavior-preserving distillation pass via a Blade (compress prose; preserve every instruction, gate, and reference). `*-template.md` files are exempt — they hold full HTML documents by design, not prose. NOT evolve — evolve only touches the learnings layer.
   - Oversized `learnings/INDEX.md` or `learnings/{domain}.md` → suggest `/phantom:evolve`.

10. **Stale sessions**: Sessions in `{TEAM_DIR}/sessions/` older than 14 days with no recent artifacts → mark stale, suggest archival to `{TEAM_DIR}/completed/`.

11. **Evolution log**: Check `{TEAM_DIR}/evolution-log.json`:
    - Total evolutions applied
    - Last evolution date
    - Any tier 2-3 proposals pending user approval
    - Any reverted changes

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
