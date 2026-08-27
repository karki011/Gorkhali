# Ship Ceremony

> **Context:** Called during `/gorkhali:wrap` only after the portable ship gate confirms current passed Inspector verification and Auditor review, plus every risk-triggered specialist. Missing, failed, blocked, or stale required evidence stops before this ceremony. No git operations happened before this point — all prior work was local-only.

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

## 4. PR Creation (ready for review)

PRs are created ready for review: Greptile auto-reviews every PR on creation (`reference/greploop.md`), so drafting bought no review control and only added a dead control point where a human had to mark the PR ready.

### Skip conditions (no PR created)

| # | Condition | Reason |
|---|-----------|--------|
| 1 | `on_main` or `on_master` | Cannot PR from default branch |
| 2 | User said "don't PR" or "no PR" | User override |
| 3 | Only artifact files changed (state/, .planning/, docs/, *.md) | No shippable code |

### Create the PR

Create the PR **autonomously** — do NOT ask the user to confirm before creating it, and do NOT offer a "spin up the app for a live look vs ship it" choice here. The PR itself is the post-PR review point: the human reviews the ready PR, and merging stays human.

### PR body

The body is neither written nor specified here. Chief rendered
`{SESSION_DIR}/pr-body.md` at `/gorkhali:wrap` Step 3 from session artifacts;
`reference/wrap/pr-body.md` is the single copy of that three-section contract.
Clerk's entire body operation is passing the file through:

```
gh pr create --title "{TICKET}: {summary}" --body-file "{SESSION_DIR}/pr-body.md"
```

Clerk never authors, fills, summarizes, or re-orders a section. Missing required
Inspector, Auditor, or triggered-specialist evidence is a blocked ship gate, not a PR
caveat.

**Preflight (mechanical, before any git operation).** Three headings present, no
section empty. On failure report `checked:fail` and do NOT create the PR — do not
repair the file, that is Chief's to re-render:

```bash
BODY="{SESSION_DIR}/pr-body.md"
for h in "What & why" "Verification" "Review focus"; do
  grep -qF "## $h" "$BODY" || exit 1
done
awk '/^## /{if (h) exit 1; h=1; next} NF {h=0} END {exit h}' "$BODY" || exit 1
```

**Repo PR template.** If the repository ships its own template, its headings win;
see `reference/wrap/pr-body.md`. Clerk may run the detection `ls` and report the
path — the mapping is Chief's.

If `gh` not available: print branch name + "run `gh pr create` when ready"

If skipped: log reason to wrap.json, print "PR skipped ({reason}). Branch pushed — create manually when ready."

## 5. All-author review + CHIEF_PING watch (always runs)

The loop **always runs as an invocation**. Do not ask. After the PR is created, hand off to greploop, which probes `review.external` and may skip:

```
Skill(skill="gorkhali:greploop", args="{PR_NUMBER}")
```

**Phase 1** classifies, tags, and resolves review comments from **all authors** (`reference/greploop.md`). Greptile comments still end with `@greptileai`; every other author is tagged `@<login>`. Bounded by `REVIEW_LOOP_MAX` (default 5).

**Phase 2** arms the standing watch (`reference/pr-watch.md`): every tick Clerk emits `CHIEF_PING` — including idle. `{new:false}` is illegal. Chief must `CHIEF_ACK`. Never merge.

- Skip if section 4 skipped the PR (no PR → no greploop).
- If `gh` unavailable or greploop errors: log a warning. Do not block the wrap. A tick without `CHIEF_PING` is failure, not quiet.

Record greploop's remaining-comment count into `wrap.json` `greptile`. greploop is the SOLE owner of writing `greptile.status` (`done`/`skipped`) back to `wrap.json` — wrap leaves it as `pending` after pinging and does not separately set it. The Stop-hook gate (`hooks/greploop-gate.js`) blocks the session from finishing while a live PR's `greptile.status` is still `pending`/missing, which is what forces greploop to run.

## 6. Jira Transition (non-blocking)

- If Atlassian MCP available AND TICKET matches `[A-Z]+-\d+`:
  a. Get available transitions: `mcp__atlassian__getTransitionsForJiraIssue({ issueIdOrKey: "{TICKET}" })`
  b. Find transition matching: "Review", "In Review", "Reviewing", "Ready for Review", or "Code Review" (case-insensitive)
  c. If found: `mcp__atlassian__transitionJiraIssue({ issueIdOrKey: "{TICKET}", transitionId: "{id}" })`
  d. Add PR link as comment: `mcp__atlassian__addCommentToJiraIssue({ issueIdOrKey: "{TICKET}", body: "PR #{number}: {url}" })`
  e. If no matching transition found: log warning, skip silently (ticket may already be in review or workflow differs)
- If Atlassian MCP unavailable: skip silently
