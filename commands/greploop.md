---
name: phantom:greploop
description: "Use when you want to drive a PR to a perfect Greptile review — iteratively trigger Greptile, fix every actionable comment, resolve threads, re-review, and repeat until 5/5 confidence with zero unresolved comments. Also use when user says 'greploop', 'loop greptile', 'get this to 5/5', 'clear all greptile comments', or 'optimize the PR against review'. Auto-invoked by phantom:wrap after a draft PR is created."
allowed-tools: ["Read", "Edit", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`
>
> Adapted for CloudZero from [greptileai/skills `greploop`](https://github.com/greptileai/skills) (MIT). GitHub-only; multi-platform branches and neutral reply tone stripped in favor of CZ conventions (tag `@greptileai`, in-thread roast-tone replies, push-before-reply).

# /phantom:greploop

Iteratively fix a GitHub PR until Greptile gives a perfect review: **5/5 confidence, zero unresolved comments**.

## Inputs

- **PR number** (optional): if omitted, detect the PR for the current branch.
- `--max N` (optional): max loop iterations (default **5**).
- `--no-fix` (optional): triage + report only; do not edit/commit.

## CZ conventions (non-negotiable)

These come from saved preferences — apply them every iteration:

- **Trigger / re-trigger** Greptile by posting `@greptileai review` (NOT `@greptile-apps[bot]`, NOT bare `/review`).
- **Reply in-thread**, never as a top-level PR comment. Endpoint: `gh api repos/{owner}/{repo}/pulls/comments/{COMMENT_ID}/replies -f body="..." --method POST` (no PR number in the path).
- **Reply tone: roasting / self-deprecating humor.** Roast yourself for the mistake, acknowledge the catch with humor, include the fix reference (commit hash / what changed), and **always end with `@greptileai`** so re-review triggers. Examples:
  - Fix: "classic speedrun — I really shipped that null deref and called it a day. Fixed in `abc1234`, take another look @greptileai"
  - Pushback: "intentional here — matches the backend contract, no churn needed on this one @greptileai"
- **Push before you reply.** Always `git push` the fix commit before posting the in-thread reply, so the reply references code that actually exists on the remote.

## 0. Identify the PR

```bash
gh pr view --json number,headRefName,headRefOid,isDraft \
  -q '{number, branch: .headRefName, head: .headRefOid, draft: .isDraft}'
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

If no PR exists, stop and tell the user. Switch to the PR branch if not already on it.

## 1. Loop (max `--max`, default 5 iterations)

### A. Trigger Greptile review

Push any pending local changes, then trigger — but only if Greptile isn't already running, to avoid stacking duplicate reviews:

```bash
git push
sleep 5

GREPTILE_STATE=$(gh pr checks {PR} --json name,state \
  | jq -r '.[] | select(.name | test("greptile"; "i")) | .state')

if [ "$GREPTILE_STATE" != "PENDING" ] && [ "$GREPTILE_STATE" != "IN_PROGRESS" ]; then
  gh pr comment {PR} --body "@greptileai review"
fi
```

> Greptile does **not** auto-trigger on draft PRs — the explicit `@greptileai review` comment is required (phantom always opens PRs as drafts).

### B. Poll the Greptile check-run to completion

```bash
HEAD_SHA=$(gh pr view {PR} --json headRefOid -q .headRefOid)

while true; do
  CHECK=$(gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/check-runs" \
    --jq '.check_runs[] | select(.name | test("greptile"; "i"))' 2>/dev/null)
  if [ -z "$CHECK" ]; then echo "waiting for greptile check…"; sleep 5; continue; fi
  STATUS=$(echo "$CHECK" | jq -r '.status // "completed"')
  [ "$STATUS" = "completed" ] && break
  echo "greptile running (status: $STATUS)…"; sleep 10
done
```

### C. Fetch review results — check ALL sources

Greptile surfaces its score in more than one place and **edits a single summary comment in place**, so always select the most-recently-`updated_at` Greptile comment, not the most-recently-created:

```bash
# 1. Latest edited general (issue) comment from Greptile — the usual home of the score + "Prompt to fix all with AI"
gh api --paginate "repos/{owner}/{repo}/issues/{PR}/comments?per_page=100" \
  | jq -s 'add | map(select(.user.login | test("greptile"; "i")))
           | sort_by(.updated_at) | last | {updated_at, body}'

# 2. PR reviews (most recent greptile-apps[bot] / greptile-apps-staging[bot] entry)
gh api repos/{owner}/{repo}/pulls/{PR}/reviews

# 3. Unresolved inline diff comments
gh api repos/{owner}/{repo}/pulls/{PR}/comments
```

Parse for:
- **Confidence score** — pattern like `4/5` or `Confidence: 5/5`.
- **Unresolved inline comments** — plus any actionable items carried in the latest summary's "Prompt to fix all with AI" section, **even if the inline endpoint returns zero**.

### D. Exit conditions

Stop the loop if **either** holds:
- Confidence is **5/5 AND zero unresolved comments**, or
- iteration count reached `--max` (report remaining).

### E. Fix actionable comments

For each unresolved comment (skip this whole step under `--no-fix`):
1. Read the file and understand the comment in context (read the full file, not just the diff).
2. Decide: actionable (code change) vs informational / false-positive.
3. If actionable, make the fix. For a substantial multi-file change, prefer spawning a `blade` (`mode: "bypassPermissions"`) rather than editing inline.

### F. Commit + push (push BEFORE replying)

```bash
git add -A
git commit -m "{TICKET}: address greptile review (greploop iter N)"   # no AI co-author trailer
git push
```

### G. Reply in-thread + resolve

For each comment, post an in-thread reply in CZ roast tone, ending with `@greptileai`:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{COMMENT_ID}/replies \
  -f body="classic speedrun — fixed in {sha}. take another look @greptileai" --method POST
```

Then batch-resolve addressed threads via GraphQL. Fetch unresolved thread IDs:

```bash
gh api graphql -f query='
query($cursor: String) {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: {PR}) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved comments(first: 1) { nodes { body path author { login } } } }
      }
    }
  }
}'
```

Resolve each addressed thread (alias batch into one mutation):

```bash
gh api graphql -f query='
mutation {
  t1: resolveReviewThread(input: {threadId: "ID1"}) { thread { isResolved } }
  t2: resolveReviewThread(input: {threadId: "ID2"}) { thread { isResolved } }
}'
```

Then `sleep 5` and return to **A**.

## 2. Report

| Field | Value |
| --- | --- |
| PR | #{number} |
| Iterations | N |
| Final confidence | X/5 |
| Comments resolved | N |
| Remaining comments | N (if any) |

```
Greploop complete.
  PR:          #1234
  Iterations:  2
  Confidence:  5/5
  Resolved:    7 comments
  Remaining:   0
```

If stopped at `--max` with work left, list the remaining items (`path:line — "comment"`) and suggest next steps. greploop never marks the PR ready-to-review — that stays a human action.
