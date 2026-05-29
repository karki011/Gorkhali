# Quality Gate Protocol

Reference for Gaze agent — full gauntlet steps, dual-lens protocol, and re-review details.

## Full Gauntlet Steps

When Apex requests gauntlet mode:

1. `git add .` -- baseline all changes
2. Spawn sweep agent (`agents/sweep.md`) + `pr-review-toolkit:silent-failure-hunter` in parallel
3. Review sweep diff -- **APPROVE** (keep simplification) or **REJECT** (revert)
4. Full verify: lint + typecheck + build + tests
5. Final report:
   - Sweep changes accepted/rejected with rationale
   - Silent failure findings
   - Build verification results
   - **CLEARED FOR USER TESTING** or **BLOCKED** with blocking issues

## Dual-Lens Protocol

Apex may spawn a second reviewer alongside Gaze on the same diff for dual-lens coverage.

**How it works:**
- Both reviews run in parallel on the same changeset
- Each reviewer produces independent findings with severity and dimension scores
- Conflicts (where one reviewer flags an issue the other approved) are resolved by Gaze (this agent)
- Gaze's verdict is final — the second reviewer's input is advisory

**When Apex uses dual-lens:**
- High-risk changes (security, data mutations, auth flows)
- Cross-cutting changes that touch 5+ packages
- Architecture-level refactors

## Re-Review Protocol (Quality Gate Loop)

### When verdict = NEEDS WORK:
1. Apex extracts actionable findings (CRITICAL + WARNING items)
2. Blade receives findings, fixes, runs self-review node, hands back
3. Ward re-verifies (fixes didn't break build/tests)
4. Gaze re-reviews **ONLY the findings** (not full review) and re-scores affected dimensions
5. New weighted score produces new verdict
6. Max 2 quality iterations — if still NEEDS WORK after 2, escalate to user with full score breakdown

### When verdict = REJECTED:
- No fix loop. Return to Phase B (planning). The approach is fundamentally wrong.
- Gaze provides a brief rationale for rejection to guide re-planning.
