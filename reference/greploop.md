# Greploop Protocol

Loaded by `/phantom:greploop`. Iteratively fix a GitHub PR until Greptile gives a perfect review:
**5/5 confidence, zero unresolved comments.**

Adapted from [greptileai/skills `greploop`](https://github.com/greptileai/skills) (MIT). GitHub-only;
multi-platform branches stripped. Tag `@greptileai`, in-thread replies, and push-before-reply are
intentional mechanics; reply tone is configurable via env `PHANTOM_GREPTILE_TONE` (`neutral` default,
`roast` for CZ-style replies).

---

## Always on

Greploop always runs — there is no opt-out. Repos that lack the Greptile bot are handled gracefully by
the Availability guard below (they don't need to opt out). Always-on, fail-open, bounded.

---

## Inputs

- **PR number** (optional): if omitted, detect the PR for the current branch.
- `--max N` (optional): max loop iterations (default **5**). Loop ceiling reference is owned by
  `hooks/loop-controller.js`.
- `--no-fix` (optional): triage + report only; do not edit/commit.

---

## Conventions (mechanics non-negotiable, tone configurable)

- Greptile **auto-reviews every PR on creation** (drafts included) — never post an initial trigger
  comment. Fallback only: `@greptileai review` (NOT `@greptile-apps[bot]`, NOT bare `/review`).
- **Reply tone** — read env `PHANTOM_GREPTILE_TONE` (default `neutral`, also accepts `roast`):
  - `neutral`: factual acknowledgment + fix reference. Fix: "Fixed in `abc1234` — take another look @greptileai". Pushback: "Intentional — matches the backend contract, no churn needed @greptileai".
  - `roast`: self-deprecating humor (CZ style). Fix: "classic speedrun — I really shipped that null deref and called it a day. Fixed in `abc1234`, take another look @greptileai". Pushback: "intentional here — matches the backend contract, no churn needed on this one @greptileai".
  - Whatever the tone: include the fix reference and **always end with `@greptileai`** so re-review triggers.
- **Push before you reply.** Always `git push` before posting replies so they reference code that exists on the remote.

---

## 0. Identify the PR

```bash
gh pr view --json number,headRefName,headRefOid,isDraft \
  -q '{number, branch: .headRefName, head: .headRefOid, draft: .isDraft}'
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

If no PR exists, stop and tell the user. Switch to the PR branch if not already on it.

---

## 1. Loop (max `--max`, default 5 iterations)

### A. Push and let Greptile review

Push pending local changes; Greptile auto-reviews on push. On later iterations, re-review is triggered by in-thread replies ending in `@greptileai` (section G). **Fallback only:** if poll B times out on a stale run, post `@greptileai review` once, guarded against an already-running review:

```bash
git push
```

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

# 4. Comments Outside Diff — parse the most-recent Greptile summary comment body for
#    <details><summary><h3>Comments Outside Diff</h3> block. Extract each numbered item:
#    file path, line(s), title, description. These have NO comment ID — they live only in
#    the summary comment body and can only be addressed via a top-level PR comment.
#    Mark extracted items source: "outside-diff".
```

Parse for:
- **Confidence score** — pattern like `4/5` or `Confidence: 5/5`.
- **Unresolved inline comments** — plus any actionable items in the summary's "Prompt to fix all with AI" section, **even if the inline endpoint returns zero**.
- **Outside-diff items** — numbered items extracted from the `<details>...Comments Outside Diff...` block; treat as unresolved until addressed.

### D. Exit conditions

Stop the loop if **either** holds:
- Confidence is **5/5 AND zero unresolved comments AND zero outside-diff items remaining**, or
- iteration count reached `--max` (report remaining).

On exit, **release the wrap gate** (see "Release the gate" below) by writing `greptile.status: "done"` into the session `wrap.json`. greploop is the SOLE writer of `greptile.status` — the Stop-hook gate (`hooks/greploop-gate.js`) blocks the session from finishing until this is recorded.

### E. Fix actionable comments

For each unresolved comment — inline and outside-diff — (skip this whole step under `--no-fix`):
1. Read the file and understand the comment in context (read the full file, not just the diff).
2. Decide: actionable (code change) vs informational / false-positive.
3. If actionable, make the fix. For a substantial multi-file change, prefer spawning a `blade` (`subagent_type: "blade"`, `name: "blade-vint"` per `reference/roster.md`, `mode: "bypassPermissions"`) rather than editing inline.

### F. Commit + push (push BEFORE replying)

```bash
git add -A
git commit -m "{TICKET}: address greptile review (greploop iter N)"   # no AI co-author trailer
git push
```

### G. Reply in-thread + resolve

**Inline comments** — post an in-thread reply in the configured tone (`PHANTOM_GREPTILE_TONE`), ending with `@greptileai`:

```bash
gh api repos/{owner}/{repo}/pulls/comments/{COMMENT_ID}/replies \
  -f body="Fixed in {sha} — take another look @greptileai" --method POST
```

**Outside-diff items** — these have no comment ID and are not review threads. Batch all outside-diff responses into ONE top-level PR comment (they cannot be GraphQL-resolved; addressing them = the fix + this reply):

```bash
gh pr comment {PR} --body "$(cat <<'EOF'
### Responses to Comments Outside Diff

**1. `{file}` line {N} — {title}**
Fixed in {sha} — take another look @greptileai

**2. `{file}` line {N} — {title}**
Intentional — matches the backend contract, no churn needed @greptileai
EOF
)"
```

Use the same tone rules as inline (`PHANTOM_GREPTILE_TONE`), always end each entry with `@greptileai`.

**Resolve inline threads** via GraphQL. Fetch unresolved thread IDs:

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

---

## Availability guard

After posting the fallback `@greptileai review` (section A), if poll B still finds **no Greptile check-run and no Greptile comment** after ~5 additional minutes, Greptile is not installed on this repo — greploop is on by default, but Greptile app coverage is per-repo. Stop the loop gracefully: report "Greptile unavailable on this repo — skipping greploop" and include a one-line note in the wrap output. Do **not** keep re-triggering. Then **release the wrap gate** (see "Release the gate" below) by writing `greptile.status: "skipped"` into the session `wrap.json`.

---

## Release the gate (write `greptile.status` to wrap.json)

The Stop-hook gate (`hooks/greploop-gate.js`) blocks the session from finishing while a draft PR's `greptile.status` is missing/`pending`. At **both** exit points above, patch the session `wrap.json` to release it: `done` on successful completion (5/5, zero unresolved), `skipped` when Greptile is unavailable on the repo.

The wrap.json path MUST be resolved with the SAME phantom-paths helpers the gate reads with (`detectRepo` + `current-session/<repo>.json` ticket precedence + `sessionsDir`) so the write lands in the byte-identical file the gate checks — a hand-built `basename $(git rev-parse --show-toplevel)` path shards under the ticket name inside worktrees and the gate never releases. Non-blocking and fail-soft — a write failure must not error the loop:

```bash
# STATUS = "done" (5/5 exit) or "skipped" (Greptile unavailable)
STATUS="done"
node -e '
  const fs=require("fs"), path=require("path");
  const root=process.env.CLAUDE_PLUGIN_ROOT
    || path.join(process.env.HOME,".claude","plugins","marketplaces","phantom");
  let pp; try{ pp=require(path.join(root,"scripts","lib","phantom-paths")); }
  catch(e){ process.exit(0); /* helper missing → fail-soft */ }
  try{
    const TICKET_RE=/[A-Z][A-Z0-9]+-\d+/;
    const repo=pp.detectRepo();
    let ticket=null;
    try{ const s=JSON.parse(fs.readFileSync(path.join(pp.stateDir(),"current-session",repo+".json"),"utf8"));
      if(typeof s.ticket==="string"&&TICKET_RE.test(s.ticket)) ticket=s.ticket.match(TICKET_RE)[0]; }catch(_){}
    if(!ticket){ try{ const b=require("child_process").execFileSync("git",["branch","--show-current"],{encoding:"utf8"});
      const m=b.match(TICKET_RE); if(m) ticket=m[0]; }catch(_){ } }
    if(!repo||!ticket) process.exit(0);
    const f=path.join(pp.sessionsDir(repo),ticket,"wrap.json");
    const w=JSON.parse(fs.readFileSync(f,"utf8"));
    w.greptile=Object.assign({},w.greptile,{status:process.argv[1]});
    fs.writeFileSync(f,JSON.stringify(w,null,2));
  }catch(e){/* fail-soft */}
' "$STATUS" || true
```

---

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
