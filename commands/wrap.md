---
name: team:wrap
description: Full shutdown with learnings + eval
---

> Load `_shared.md` + `_shared-crew.md` + `_shared-contracts.md` before executing.

# /team:wrap

Full shutdown:

1. **Run Pre-Wrap Hook** -- verify implementation, test, and review status is recorded
2. `TaskCreate({ subject: "[Luffy] SESSION:wrap" })` — hook handles archival + cleanup
3. Write session file to `sessions/{ticket}/{date}_{label}.md`
4. Write new decisions to the correct file:
   - **Feature-specific** -> `sessions/{ticket}/decisions.md`
   - **Cross-cutting** -> `decisions/global.md`
   - When in doubt, put it in the session
5. **Run crew evaluation** (see `/team:eval`) -- record scores in session file
6. **Robin writes a Captain's Log chapter** -- MANDATORY, never skip:
   - Spawn Robin agent (run_in_background: true) with session files + state JSON as context
   - Robin writes `{STORY}/chapter-{NN}-{slug}.md` (next chapter number, kebab-case slug)
   - `{STORY}` = `~/.claude/team/story/` -- GLOBAL, shared across all repos
   - Format: anime narrator voice matching previous chapters
   - Must include: `# Chapter N: Title`, Arc/Date/Crew/Repo metadata, story narrative, Key Moments with crew quotes, Decisions section, Horizon section
   - Each chapter MUST have `> **Repo:** {REPO_NAME}` in metadata
   - End with `---\n*Chapter N of the Straw Hat Chronicles*`
   - Update `{STORY}/index.md` with new chapter entry
7. Update learnings — append to the relevant **domain file** in `learnings/` (ui.md, data.md, auth.md, testing.md, crew.md, migration.md, tooling.md):
   - New patterns → under `## Patterns` in the matching domain file
   - New corrections → under `## Corrections` in the matching domain file
   - New habits → under `## Habits` in the matching domain file
   - If a new entry doesn't fit an existing domain, create a new `learnings/{domain}.md` with all 3 sections
8. Update `learnings/INDEX.md` quick reference with one-liners for any new entries
10. Update auto-memory (`project_*.md` in memory dir)
11. Shut down crew
