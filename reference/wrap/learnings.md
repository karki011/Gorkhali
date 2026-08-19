# Learnings Recording

> **Context:** Called during `/phantom:wrap` after RPSL passes and before ship ceremony. Expects `{TEAM_DIR}/sessions/{TICKET}/` directory with session artifacts. Writes to `learnings/` domain files and `sessions/{TICKET}/`.

## 1. Session File

Write session file to `sessions/{ticket}/{date}_{label}.md`

## 2. Decisions

Write new decisions to the correct file:
- **Feature-specific** -> `sessions/{ticket}/decisions.md`
- **Cross-cutting** -> `decisions/global.md`
- When in doubt, put it in the session

## 3. Shadows Evaluation

Run shadows evaluation (see `/phantom:eval`) — record scores in session file.

## 4. Update Learnings

Append to the relevant **domain file** in `learnings/` (ui.md, data.md, auth.md, testing.md, shadows.md, migration.md, tooling.md, model-routing.md):
- New patterns -> under `## Patterns` with `[proposed]` or `[validated:1]` lifecycle tag
- New corrections -> under `## Corrections` with `[failed]` tag + approach signature format: `CORRECTION [{keyword}]: [{failure}] — [{alternative}] [failed] ({date})`
- New habits -> under `## Habits` with `[validated:1]` tag
- If a new entry doesn't fit an existing domain, create a new `learnings/{domain}.md` with all 3 sections
- **model-routing.md**: written only when wrap.json.modelRouting is present and its deltas or fallbacks array is non-empty. Append under `## Habits` using the format: `ROUTING [{role}]: requested {profile} - actual {profile} - {outcome} [{lifecycle}] ({date})`. Recurrence of the same signature increments `[validated:N]` per the existing counter rules in section 6.

## 5. INDEX Update

Update `learnings/INDEX.md` quick reference with one-liners for any new entries (include lifecycle tag).

## 6. Validation Counters

**Increment validation counters** — for each pattern in INDEX.md that was successfully used during this session (Chief explicitly relied on it, or Engineer followed it without issues), increment `[validated:N]` -> `[validated:N+1]`. This builds confidence signal over time.

## 7. Promotion Check

For any pattern with `[validated:5+]` that is technology-generic (not repo-specific), offer to promote to `${PHANTOM_DATA:-~/.phantom}/global/patterns/INDEX.md` with `[scope:global] derived_from:{REPO_NAME}` tag. Global entry starts at `[validated:1]` regardless of source count.

## 8. Caveman Compress

For each learnings file that was modified this session, run:
```bash
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
SCRIPTS="$PR/scripts"
if [ -n "$PR" ] && command -v python3 >/dev/null 2>&1 && [ -d "$SCRIPTS/compress" ]; then
  (cd "$SCRIPTS" && python3 -m compress <absolute_path>) || echo "Skipping caveman compress: compression unavailable."
else
  echo "Skipping caveman compress: python3 or scripts/compress not available."
fi
```
Skip `INDEX.md` (already terse). This keeps learnings compressed for future sessions.

## 9. Auto-learning Trigger 3

- Validate all patterns used this session: increment `[validated:N]` on patterns that held, downgrade patterns that caused issues
- Auto-promote `[validated:5+]` patterns to `global/patterns/INDEX.md`
- Auto-demote patterns not validated in 30+ days -> `[stale]`
- Append session summary to INDEX.md: `SESSION {TICKET}: route={route}, outcome={outcome}, fix_loops={N}, patterns_validated={N}, corrections_added={N} ({date})`
- See `_shared-auto-learning.md` for full protocol

## 10. Testgaps Scan (advisory — does not block wrap)

Check for changed source files without corresponding test changes:
```bash
# Get source files changed in this session (exclude tests, configs, docs)
git diff main...HEAD --name-only | grep -E '\.(ts|tsx|js|jsx|go|py)$' | grep -v -E '(test|spec|__tests__|_test\.go)' > /tmp/changed-sources.txt
# Get test files changed
git diff main...HEAD --name-only | grep -E '(test|spec|__tests__|_test\.go)' > /tmp/changed-tests.txt
```
For each source file, check if a matching test file was also changed. If gaps found:
- Log to `learnings/testing.md`: `TESTGAP: {file} changed without test update ({date})`
- Report in wrap summary: "Test gaps: {N} source files changed without corresponding test updates"
- Do NOT block — this is informational. User decides whether to address before PR.
