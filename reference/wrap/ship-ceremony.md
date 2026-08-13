# Ship Ceremony

> **Context:** Called during `/phantom:wrap` only after the portable ship gate confirms current passed Ward verification and Gaze review, plus every risk-triggered specialist. Missing, failed, blocked, or stale required evidence stops before this ceremony. No git operations happened before this point — all prior work was local-only.

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

Create the draft PR **autonomously** — do NOT ask the user to confirm before creating it, and do NOT offer a "spin up the app for a live look vs ship it" choice here. The draft PR itself is the post-PR review point: the human inspects it and marks it ready-to-review (that action stays human).

### PR body (fixed five-section template)

The body is NOT written here. Apex rendered `{SESSION_DIR}/pr-body.md` at
`/phantom:wrap` Step 2 from session artifacts, per
`reference/wrap/pr-body.md`. Warden's entire body operation is passing that file
through:

```
gh pr create --draft --title "{TICKET}: {summary}" --body-file "{SESSION_DIR}/pr-body.md"
```

The five headings, in this order, verbatim:

```
## Goal
{intent.json — problem, goal, doneWhen[]}

## Approach
{plan.json — decision.recommendation, solution_shape.summary, alternatives[]}
{execution.json — filesChanged, grouped by concern}

## Risk
{plan.json — risks[] as risk — mitigation — reversibility}
{intent.json — tradeoffs[], nonNegotiables[]}
{review findings that shipped accepted rather than fixed}

## Verification evidence
{Ward checks and outcomes from the current portable verification artifact}
{userVerification from the same artifact}
{Gaze verdict and findings count from the current portable review artifact}
{each triggered specialist and outcome from the current portable review artifact}
{optional RPSL outcome only when deep review was explicitly selected}

## What to look at first
{ranked path:line pointers — unfixed findings, then plan risks, then
 nonNegotiables, then largest changed files; at most five}
```

Warden never authors, fills, summarizes, or re-orders a section. If a section's
source artifact was absent, Apex already wrote the stated-gap line for it — an
italic `_Not recorded: {artifact} — {what was missing}._` naming the artifact
that would have supplied it. A guess, an `N/A`, or an empty section is a failure,
not a fallback.

Never omit required validation or invent content to fill it. Missing required Ward,
Gaze, or triggered-specialist evidence is a blocked ship gate, not a PR caveat —
which is why `## Verification evidence` has no stated-gap line: it cannot
legitimately be empty at this point. Omit only optional validation that was not
selected.

**Preflight (mechanical, before any git operation).** Five headings present, no
section empty. On failure report `checked:fail` and do NOT create the PR — do not
repair the file, that is Apex's to re-render:

```bash
BODY="{SESSION_DIR}/pr-body.md"
for h in "Goal" "Approach" "Risk" "Verification evidence" "What to look at first"; do
  grep -qF "## $h" "$BODY" || exit 1
done
awk '/^## /{if (h) exit 1; h=1; next} NF {h=0} END {exit h}' "$BODY" || exit 1
```

**Repo PR template.** If the repository ships its own template, its headings win
and the five values are placed under them; see `reference/wrap/pr-body.md`.
Warden may run the detection `ls` and report the path — the mapping is Apex's.

If `gh` not available: print branch name + "run `gh pr create --draft` when ready"

If skipped: log reason to wrap.json, print "PR skipped ({reason}). Branch pushed — create manually when ready."

## 5. Greptile Review Loop (always runs)

The loop **always runs**. Greptile does NOT auto-trigger on draft PRs (only on ready-to-review). We drive it explicitly and loop until it's happy.

After the draft PR is created, hand off to the greploop skill:

```
Skill(skill="phantom:greploop", args="{PR_NUMBER}")
```

This triggers Greptile (`@greptileai review`), polls the check-run, fixes actionable comments, replies in-thread (tone from `PHANTOM_GREPTILE_TONE`: `neutral` default, `roast` opt-in), resolves threads, and re-reviews — looping until **5/5 confidence with zero unresolved comments** or the iteration ceiling (default 5).

- Skip if section 4 skipped the PR (no PR → no greploop).
- If `gh`/Greptile unavailable or greploop errors: log a warning and tell the user "Greptile loop not run — request manually with `@greptileai review` or mark PR ready-to-review." Do not block the wrap.

Record greploop's final confidence + remaining-comment count into `wrap.json` `greptile`. greploop is the SOLE owner of writing `greptile.status` (`done`/`skipped`) back to `wrap.json` — wrap leaves it as `pending` after pinging and does not separately set it. The Stop-hook gate (`hooks/greploop-gate.js`) blocks the session from finishing while a draft PR's `greptile.status` is still `pending`/missing, which is what forces greploop to run.

## 6. Jira Transition (non-blocking)

- If Atlassian MCP available AND TICKET matches `[A-Z]+-\d+`:
  a. Get available transitions: `mcp__atlassian__getTransitionsForJiraIssue({ issueIdOrKey: "{TICKET}" })`
  b. Find transition matching: "Review", "In Review", "Reviewing", "Ready for Review", or "Code Review" (case-insensitive)
  c. If found: `mcp__atlassian__transitionJiraIssue({ issueIdOrKey: "{TICKET}", transitionId: "{id}" })`
  d. Add PR link as comment: `mcp__atlassian__addCommentToJiraIssue({ issueIdOrKey: "{TICKET}", body: "PR #{number}: {url}" })`
  e. If no matching transition found: log warning, skip silently (ticket may already be in review or workflow differs)
- If Atlassian MCP unavailable: skip silently
