---
name: team:wrap
description: "Use when work is done, ready to create PR, finishing a session, or shutting down. Runs crew eval, saves learnings, creates PR or pushes branch."
---

> Load `_shared.md` + `_shared-crew.md` + `_shared-contracts.md` before executing.

# /team:wrap

Full shutdown:

1. **Run Pre-Wrap Hook** -- verify implementation, test, and review status is recorded
2. `TaskCreate({ subject: "[Cortex] SESSION:wrap" })` — hook handles archival + cleanup
3. Write session file to `sessions/{ticket}/{date}_{label}.md`
4. Write new decisions to the correct file:
   - **Feature-specific** -> `sessions/{ticket}/decisions.md`
   - **Cross-cutting** -> `decisions/global.md`
   - When in doubt, put it in the session
5. **Run crew evaluation** (see `/team:eval`) -- record scores in session file
6. Update learnings — append to the relevant **domain file** in `learnings/` (ui.md, data.md, auth.md, testing.md, crew.md, migration.md, tooling.md):
   - New patterns → under `## Patterns` with `[proposed]` or `[validated:1]` lifecycle tag
   - New corrections → under `## Corrections` with `[failed]` tag + approach signature format: `CORRECTION [{keyword}]: [{failure}] — [{alternative}] [failed] ({date})`
   - New habits → under `## Habits` with `[validated:1]` tag
   - If a new entry doesn't fit an existing domain, create a new `learnings/{domain}.md` with all 3 sections
7. Update `learnings/INDEX.md` quick reference with one-liners for any new entries (include lifecycle tag)
7b. **Increment validation counters** — for each pattern in INDEX.md that was successfully used during this session (Cortex explicitly relied on it, or Spark followed it without issues), increment `[validated:N]` → `[validated:N+1]`. This builds confidence signal over time.
7c. **Promotion check** — for any pattern with `[validated:5+]` that is technology-generic (not repo-specific), offer to promote to `~/.claude/team/global/patterns/INDEX.md` with `[scope:global] derived_from:{REPO_NAME}` tag. Global entry starts at `[validated:1]` regardless of source count.
8. **Caveman-compress updated learnings** — for each learnings file that was modified this session, run:
   ```bash
   cd ~/.claude/plugins/marketplaces/caveman/compress && python3 -m scripts <absolute_path>
   ```
   Skip `INDEX.md` (already terse). This keeps learnings compressed for future sessions.
8b. **Phantom outcome feedback** (if phantom available):
   - Call `phantom_evaluate_output` with verification summary + Prism verdict as output, original goal as context
   - This closes phantom's learning loop — the orchestrator records success/failure and adjusts strategy weights for similar future goals
   - If verification failed: phantom records failure reason, penalizing the strategy for similar goals going forward
8c. **AUTO-LEARNING TRIGGER 3 — MANDATORY, NO SKIP:**
   - Validate all patterns used this session: increment `[validated:N]` on patterns that held, downgrade patterns that caused issues
   - Auto-promote `[validated:5+]` patterns to `global/patterns/INDEX.md`
   - Auto-demote patterns not validated in 30+ days → `[stale]`
   - Append session summary to INDEX.md: `SESSION {TICKET}: route={route}, outcome={outcome}, fix_loops={N}, patterns_validated={N}, corrections_added={N} ({date})`
   - See `_shared-auto-learning.md` for full protocol
   - Wrap MUST NOT complete without this step
9. Update auto-memory (`project_*.md` in memory dir)
10. Shut down crew
