---
name: phantom:greploop
description: "Use when you want to drive a PR to a perfect Greptile review — iteratively trigger Greptile, fix every actionable comment, resolve threads, re-review, and repeat until 5/5 confidence with zero unresolved comments. Also use when user says 'greploop', 'loop greptile', 'get this to 5/5', 'clear all greptile comments', or 'optimize the PR against review'. Auto-invoked by phantom:wrap after a draft PR is created."
allowed-tools: ["Read", "Edit", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`
>
> Adapted from [greptileai/skills `greploop`](https://github.com/greptileai/skills) (MIT). GitHub-only; multi-platform branches stripped. Tag `@greptileai`, in-thread replies, and push-before-reply are intentional mechanics; reply tone is configurable via env `PHANTOM_GREPTILE_TONE` (`neutral` default, `roast` for CZ-style replies).

# /phantom:greploop

Iteratively fix a GitHub PR until Greptile gives a perfect review: **5/5 confidence, zero unresolved comments**.

## Gate: `PHANTOM_GREPTILE`

If env `PHANTOM_GREPTILE` is not `1`: print "○ greploop skipped (set PHANTOM_GREPTILE=1 to enable)" and stop. Not an error — installs without the Greptile bot simply don't loop.

## Inputs

- **PR number** (optional): if omitted, detect the PR for the current branch.
- `--max N` (optional): max loop iterations (default **5**).
- `--no-fix` (optional): triage + report only; do not edit/commit.

## Conventions (mechanics non-negotiable, tone configurable)

Apply every iteration:

- Greptile **auto-reviews every PR on creation** (drafts included) — never post an initial trigger comment. For re-trigger/fallback only, post `@greptileai review` (NOT `@greptile-apps[bot]`, NOT bare `/review`).
- **Reply in-thread**, never as a top-level PR comment. Endpoint: `gh api repos/{owner}/{repo}/pulls/comments/{COMMENT_ID}/replies -f body="..." --method POST` (no PR number in the path).
- **Reply tone** — read env `PHANTOM_GREPTILE_TONE` (default `neutral`, also accepts `roast`):
  - `neutral`: factual acknowledgment + fix reference. Fix: "Fixed in `abc1234` — take another look @greptileai". Pushback: "Intentional — matches the backend contract, no churn needed @greptileai".
  - `roast`: self-deprecating humor (CZ style). Fix: "classic speedrun — I really shipped that null deref and called it a day. Fixed in `abc1234`, take another look @greptileai". Pushback: "intentional here — matches the backend contract, no churn needed on this one @greptileai".
  - Whatever the tone: include the fix reference (commit hash / what changed) and **always end with `@greptileai`** so re-review triggers.
- **Push before you reply.** Always `git push` the fix commit before posting the in-thread reply, so the reply references code that actually exists on the remote.

## 0. Identify the PR

```bash
gh pr view --json number,headRefName,headRefOid,isDraft \
  -q '{number, branch: .headRefName, head: .headRefOid, draft: .isDraft}'
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

If no PR exists, stop and tell the user. Switch to the PR branch if not already on it.

## 1. Loop (max `--max`, default 5 iterations)

### A. Push and let Greptile review

Greptile auto-reviews every PR on creation (drafts included) — **never post an initial `@greptileai review` comment**; it just stacks a redundant duplicate review. Push any pending local changes and go straight to polling (B):

```bash
git push
```

On later iterations, re-review is triggered by the in-thread fix replies ending in `@greptileai` (section G) — no separate trigger comment needed there either. **Fallback only:** if no new Greptile check-run appears within ~3 minutes of a push (poll B times out on a stale run), post `@greptileai review` once, guarded against an already-running review:

```bash
GREPTILE_STATE=$(gh pr checks {PR} --json name,state \
  | jq -r '.[] | select(.name | test("greptile"; "i")) | .state')

if [ "$GREPTILE_STATE" != "PENDING" ] && [ "$GREPTILE_STATE" != "IN_PROGRESS" ]; then
  gh pr comment {PR} --body "@greptileai review"
fi
```

### B. Poll the Greptile check-run to completion

```bash
HEAD_SHA=$(gh pr view {PR} --json headRefOid -q .headRefOid)

WAITED=0
while true; do
  # Select exactly ONE greptile check-run (latest by started_at) so gh's --jq emits a
  # single clean JSON value. A bare `.check_runs[] | select(...)` emits multiple
  # concatenated objects when several greptile runs exist (re-runs, staging+prod), which
  # makes the STATUS test below silently never match. Run this block verbatim — do NOT
  # improvise a `gh api … | jq` poll that re-pipes a Greptile comment body, or jq throws
  # "Invalid string: control characters from U+0000 through U+001F must be escaped".
  CHECK=$(gh api "repos/{owner}/{repo}/commits/$HEAD_SHA/check-runs" \
    --jq '[.check_runs[] | select(.name | test("greptile"; "i"))]
          | sort_by(.started_at) | last // empty' 2>/dev/null)
  if [ -z "$CHECK" ]; then
    if [ "$WAITED" -ge 180 ]; then break; fi   # no auto-review coming → fall back to trigger in A
    echo "waiting for greptile check…"; sleep 5; WAITED=$((WAITED+5)); continue
  fi
  STATUS=$(printf '%s' "$CHECK" | jq -r '.status // "completed"')
  [ "$STATUS" = "completed" ] && break
  echo "greptile running (status: $STATUS)…"; sleep 10
done
```

If the wait expires with no check-run on this head SHA (e.g., a PR that predates Greptile auto-review, or a missed auto-trigger), apply the **fallback trigger from A** (`@greptileai review`, guarded), then re-enter this poll.

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

For each comment, post an in-thread reply in the configured tone (`PHANTOM_GREPTILE_TONE`), ending with `@greptileai`:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{COMMENT_ID}/replies \
  -f body="Fixed in {sha} — take another look @greptileai" --method POST
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

## Availability guard

After posting the fallback `@greptileai review` (section A), if poll B still finds **no Greptile check-run and no Greptile comment** after ~5 additional minutes, Greptile is not installed on this repo — `PHANTOM_GREPTILE=1` only opts this run in, but Greptile app coverage is per-repo. Stop the loop gracefully: report "Greptile unavailable on this repo — skipping greploop" and include a one-line note in the wrap output. Do **not** keep re-triggering.

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
