# Ship Ceremony

> **Context:** Called during `/phantom:wrap` after RPSL passes. No git operations happened before this point — all prior work was local-only. Expects `{TEAM_DIR}/sessions/{TICKET}/execution.json` and `verification.json` to exist.

## 1. Stage Changed Files

<NEVER_COMMIT_SECRETS>

- Read `{TEAM_DIR}/sessions/{TICKET}/execution.json` for `filesChanged` list if available
- Fallback: `git diff --name-only main...HEAD`
- `git add <each file>` (never `git add -A`)
- Skip: `.env`, `credentials.*`, `*.key`, `*.pem` (warn if found)

</NEVER_COMMIT_SECRETS>

## 2. Commit

- Message format: `{TICKET}: {summary}`
- Do NOT add "Co-Authored-By: AI" or any AI attribution

## 3. Push

- `git push -u origin $(git branch --show-current)`
- If push fails (no remote, auth error): warn user, continue to archive

## 4. PR Creation (always draft)

PRs are ALWAYS created as drafts. Never ready-to-review. Reasons:
- Greptile auto-triggers on ready-to-review but NOT on drafts — we control when review starts
- Draft signals "AI-generated, needs human review before merge"
- Human marks ready-to-review after inspecting changes

### Skip conditions (no PR created)

| # | Condition | Reason |
|---|-----------|--------|
| 1 | `on_main` or `on_master` | Cannot PR from default branch |
| 2 | User said "don't PR" or "no PR" | User override |
| 3 | Only artifact files changed (state/, .planning/, docs/, *.md) | No shippable code |

### Create draft PR

```
gh pr create --draft --title "{TICKET}: {summary}" --body "{body}"
```

PR body:
```
## Summary
{1-3 bullet points from intent or session context}

## Changes
{files changed, grouped by concern}

## Test plan
{verification results from verification.json if available}
```

If `gh` not available: print branch name + "run `gh pr create --draft` when ready"

If skipped: log reason to wrap.json, print "PR skipped ({reason}). Branch pushed — create manually when ready."

## 5. Greptile Review Loop (gated on `integrations.greptile`)

Check `integrations.greptile` in config.yaml. If `false` or absent: print "○ Greptile loop skipped (integrations.greptile not enabled)", record `greptile: { requested: false, status: "skipped" }` in `wrap.json`, and continue to section 6.

When enabled: Greptile does NOT auto-trigger on draft PRs (only on ready-to-review). We drive it explicitly and loop until it's happy.

After the draft PR is created, hand off to the greploop skill:

```
Skill(skill="phantom:greploop", args="{PR_NUMBER}")
```

This triggers Greptile (`@greptileai review`), polls the check-run, fixes actionable comments, replies in-thread (tone from `greptile.reply_tone`: `neutral` default, `roast` opt-in), resolves threads, and re-reviews — looping until **5/5 confidence with zero unresolved comments** or the iteration ceiling (default 5).

- Skip if section 4 skipped the PR (no PR → no greploop).
- User override: `--no-greploop` on wrap → fall back to a single trigger (`gh pr comment {PR_NUMBER} --body "@greptileai review"`) and stop.
- If `gh`/Greptile unavailable or greploop errors: log a warning and tell the user "Greptile loop not run — request manually with `@greptileai review` or mark PR ready-to-review." Do not block the wrap.

Record greploop's final confidence + remaining-comment count into `wrap.json` `greptile`.

## 6. Jira Transition (non-blocking)

- If Atlassian MCP available AND TICKET matches `[A-Z]+-\d+`:
  a. Get available transitions: `mcp__atlassian__getTransitionsForJiraIssue({ issueIdOrKey: "{TICKET}" })`
  b. Find transition matching: "Review", "In Review", "Reviewing", "Ready for Review", or "Code Review" (case-insensitive)
  c. If found: `mcp__atlassian__transitionJiraIssue({ issueIdOrKey: "{TICKET}", transitionId: "{id}" })`
  d. Add PR link as comment: `mcp__atlassian__addCommentToJiraIssue({ issueIdOrKey: "{TICKET}", body: "PR #{number}: {url}" })`
  e. If no matching transition found: log warning, skip silently (ticket may already be in review or workflow differs)
- If Atlassian MCP unavailable: skip silently
