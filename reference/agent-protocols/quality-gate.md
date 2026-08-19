# Quality Gate Protocol

Reference for Auditor agent — full gauntlet steps, dual-auditor protocol, and re-review details.

## Full Gauntlet Steps

When Chief requests gauntlet mode:

1. `git add .` -- baseline all changes
2. Spawn steward agent (`agents/steward.md`, `subagent_type: "steward"`, `name: "steward-tessle"`) + `pr-review-toolkit:silent-failure-hunter` (`name: "hunter-quarrick"`) in parallel — names per `reference/roster.md`
3. Review steward diff -- **APPROVE** (keep simplification) or **REJECT** (revert)
4. Full verify: lint + typecheck + build + tests
5. Final report:
   - Steward changes accepted/rejected with rationale
   - Silent failure findings
   - Build verification results
   - **CLEARED FOR USER TESTING** or **BLOCKED** with blocking issues

## Dual-Auditor Protocol

Chief may spawn a second reviewer alongside Auditor on the same diff for dual-auditor coverage
(`subagent_type: "auditor"`, `name: "auditor-pruett"` per `reference/roster.md`).

**How it works:**
- Both reviews run in parallel on the same changeset
- Each reviewer produces independent findings with severity and dimension scores
- Conflicts (where one reviewer flags an issue the other approved) are resolved by Auditor (this agent)
- Auditor's verdict is final — the second reviewer's input is advisory

**When Chief uses dual-auditor:**
- High-risk changes (security, data mutations, auth flows)
- Cross-cutting changes that touch 5+ packages
- Architecture-level refactors

## Re-Review Protocol (Quality Gate Loop)

### When verdict = NEEDS WORK:
1. Chief extracts actionable findings (CRITICAL + WARNING items)
2. Engineer receives findings, fixes, runs self-review node, hands back
3. Inspector re-verifies (fixes didn't break build/tests)
4. Auditor re-reviews **ONLY the findings** (not full review) and re-scores affected dimensions
5. New weighted score produces new verdict
6. Max 2 quality iterations — if still NEEDS WORK after 2, escalate to user with full score breakdown

### When verdict = REJECTED:
- No fix loop. Return to Phase B (planning). The approach is fundamentally wrong.
- Auditor provides a brief rationale for rejection to guide re-planning.
