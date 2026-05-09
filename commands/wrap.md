---
name: team:wrap
description: "Use when work is done, ready to create PR, finishing a session, or shutting down. Runs crew eval, saves learnings, creates PR or pushes branch."
---

> Load `_shared.md` + `_shared-crew.md` + `_shared-contracts.md` before executing.

# /team:wrap

Full shutdown:

1. **Run Pre-Wrap Hook** -- verify implementation, test, and review status is recorded
2. `TaskCreate({ subject: "[Cortex] SESSION:wrap" })` — hook handles archival + cleanup
3. **Diff-against-main review** (scope creep detection):
   Before creating PR or pushing branch:
   a. Run `git diff main...HEAD --stat` to see all changed files
   b. Run `git diff main...HEAD` for full diff
   c. Cortex reviews: "Do these changes align with the contract scope?"
   
   Check for:
   - Files changed that aren't in the contract scope → flag as scope creep
   - Unrelated formatting/refactoring changes → separate or revert
   - Debug/console.log statements left in → remove
   - TODO comments added → document or remove
   
   If scope creep detected:
   - Present to user: "These files weren't in the original scope: [list]. Keep or revert?"
   - User decides before PR is created
   
   If clean → proceed to next step
4. Write session file to `sessions/{ticket}/{date}_{label}.md`
5. Write new decisions to the correct file:
   - **Feature-specific** -> `sessions/{ticket}/decisions.md`
   - **Cross-cutting** -> `decisions/global.md`
   - When in doubt, put it in the session
6. **Run crew evaluation** (see `/team:eval`) -- record scores in session file
7. Update learnings — append to the relevant **domain file** in `learnings/` (ui.md, data.md, auth.md, testing.md, crew.md, migration.md, tooling.md):
   - New patterns → under `## Patterns` with `[proposed]` or `[validated:1]` lifecycle tag
   - New corrections → under `## Corrections` with `[failed]` tag + approach signature format: `CORRECTION [{keyword}]: [{failure}] — [{alternative}] [failed] ({date})`
   - New habits → under `## Habits` with `[validated:1]` tag
   - If a new entry doesn't fit an existing domain, create a new `learnings/{domain}.md` with all 3 sections
8. Update `learnings/INDEX.md` quick reference with one-liners for any new entries (include lifecycle tag)
8b. **Increment validation counters** — for each pattern in INDEX.md that was successfully used during this session (Cortex explicitly relied on it, or Spark followed it without issues), increment `[validated:N]` → `[validated:N+1]`. This builds confidence signal over time.
8c. **Promotion check** — for any pattern with `[validated:5+]` that is technology-generic (not repo-specific), offer to promote to `~/.claude/team/global/patterns/INDEX.md` with `[scope:global] derived_from:{REPO_NAME}` tag. Global entry starts at `[validated:1]` regardless of source count.
9. **Caveman-compress updated learnings** — for each learnings file that was modified this session, run:
   ```bash
   cd ~/.claude/plugins/marketplaces/caveman/compress && python3 -m scripts <absolute_path>
   ```
   Skip `INDEX.md` (already terse). This keeps learnings compressed for future sessions.
9b. **Phantom outcome feedback** (if phantom available):
   - Call `phantom_evaluate_output` with verification summary + Prism verdict as output, original goal as context
   - This closes phantom's learning loop — the orchestrator records success/failure and adjusts strategy weights for similar future goals
   - If verification failed: phantom records failure reason, penalizing the strategy for similar goals going forward
9c. **AUTO-LEARNING TRIGGER 3 — MANDATORY, NO SKIP:**
   - Validate all patterns used this session: increment `[validated:N]` on patterns that held, downgrade patterns that caused issues
   - Auto-promote `[validated:5+]` patterns to `global/patterns/INDEX.md`
   - Auto-demote patterns not validated in 30+ days → `[stale]`
   - Append session summary to INDEX.md: `SESSION {TICKET}: route={route}, outcome={outcome}, fix_loops={N}, patterns_validated={N}, corrections_added={N} ({date})`
   - See `_shared-auto-learning.md` for full protocol
   - Wrap MUST NOT complete without this step
10. Update auto-memory (`project_*.md` in memory dir)
11. Shut down crew

---

> **Output on wrap complete:**
> ```
>   ╭───────────────────────────╮
>   │                           │
>   │   SESSION WRAPPED  ✓      │
>   │                           │
>   │   Ticket:  {TICKET}       │
>   │   Route:   {SOLO|CREW}    │
>   │   Outcome: {pass|fail}    │
>   │   Loops:   {N}            │
>   │   Learned: {N} patterns   │
>   │   Corrections: {N}        │
>   │                           │
>   ╰───────────────────────────╯
> ```
> Fun sign-off (random): "Cortex out. Mic drop." | "Learnings saved. Brain bigger." | "Session archived. History written." | "Until next time, crew." | "Patterns locked. Mistakes noted. Moving on."
