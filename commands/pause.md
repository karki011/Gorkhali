---
name: team:pause
description: "Use when stepping away, switching context, taking a break, or saving progress. Saves session state, learnings, and resume notes."
---

> Load `_shared.md` (core only -- no additional tiers needed).

# /team:pause

Full save -- persist ALL session knowledge before stepping away:

1. `TaskCreate({ subject: "[Cortex] SESSION:pause" })` — hook handles session status change
2. Write session log to `sessions/{TICKET}/{date}_{label}.md` with summary, PRs, decisions, resume notes
3. Append new learnings to the relevant **domain files** in `learnings/` (ui.md, data.md, auth.md, testing.md, crew.md, migration.md, tooling.md):
   - Patterns → `## Patterns` section in matching domain file
   - Corrections → `## Corrections` section in matching domain file
   - Habits → `## Habits` section in matching domain file
4. Update `learnings/INDEX.md` quick reference with one-liners for new entries
6. Update/create project memory in auto-memory dir (`project_*.md`)
7. Update `MEMORY.md` index if new memory files were created

**This is NOT optional** -- every pause saves the full knowledge set. The user should never have to ask for learnings separately.
