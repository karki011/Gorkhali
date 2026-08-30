# Greploop Protocol

Loaded by `/gorkhali:greploop`. Two phases after wrap creates a ready-for-review PR:

1. **Phase 1 — all-author classify / tag / resolve.** Fetch review comments from
   every author, classify them, fix or push back, tag the author, resolve threads.
   Greptile comments still end with `@greptileai`.
2. **Phase 2 — arm watch.** Write `{SESSION_DIR}/pr-watch.json` and run
   `scripts/lib/pr-watch-tick.js` (`reference/pr-watch.md`). The script stops
   on resolved threads or Greptile 5/5. Idle still pings Chief only while dirty.

Adapted from [greptileai/skills `greploop`](https://github.com/greptileai/skills) (MIT). GitHub-only;
multi-platform branches stripped. Tag `@greptileai`, in-thread replies, and push-before-reply are
intentional mechanics; reply tone for Greptile is configurable via env `GORKHALI_GREPTILE_TONE` (`neutral` default,
`roast` for CZ-style replies).

---

## Always invoked, capability-gated

Wrap always invokes greploop after PR creation and never asks. Greploop itself
probes `review.external` (`greptile` | `none`) and Greptile availability. When
the value is `none`, or the key is unset and no Greptile check-run exists,
greploop writes `greptile.status: skipped` and stops. Repos that lack the
Greptile bot do not need to opt out. Fail-open, bounded. Never merge. Merging
stays a human action.

---

## Inputs

- **PR number** (optional): if omitted, detect the PR for the current branch.
- `--max N` (optional): max Phase 1 loop iterations (default **`REVIEW_LOOP_MAX`**, 5, from
  `scripts/lib/constants.js`).
- `--no-fix` (optional): triage + report only; do not edit/commit.
- `--fix-humans` (optional): also auto-fix actionable comments from human
  reviewers. Default auto-fix is the configured external bot only.

---

## Conventions (mechanics non-negotiable, tone configurable)

- Greptile **auto-reviews every PR on creation** (drafts included) — never post an initial trigger
  comment. Fallback only: `@greptileai review` (NOT `@greptile-apps[bot]`, NOT bare `/review`).
- **All-author.** Phase 1 does not filter to Greptile. Human reviewers, other bots, and Greptile
  are classified with the same rules. Only the **tag** differs:
  - Greptile (login matches `greptile`): always end the reply with **`@greptileai`**.
  - Every other author: tag **`@<login>`**.
- **Reply tone (Greptile only)** — read env `GORKHALI_GREPTILE_TONE` (default `neutral`, also accepts `roast`):
  - `neutral`: factual acknowledgment + fix reference. Fix: "Fixed in `abc1234` — take another look @greptileai". Pushback: "Intentional — matches the backend contract, no churn needed @greptileai".
  - `roast`: self-deprecating humor (CZ style). Fix: "classic speedrun — I really shipped that null deref and called it a day. Fixed in `abc1234`, take another look @greptileai". Pushback: "intentional here — matches the backend contract, no churn needed on this one @greptileai".
  - Whatever the tone: include the fix reference and **always end with `@greptileai`** so re-review triggers.
- **Other authors** use a factual acknowledgment + fix reference, ending with `@<login>`.
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

## Phase 1. All-author classify / tag / resolve (max `--max`, default `REVIEW_LOOP_MAX`)

### A. Push and let reviews land

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

If Greptile is not installed, skip this poll and continue — Phase 1 still classifies every other author.

### C. Fetch review results — ALL authors, ALL sources

Do **not** filter to Greptile. Collect every unresolved item, then classify.

```bash
# 1. Issue comments (all authors)
gh api --paginate "repos/{owner}/{repo}/issues/{PR}/comments?per_page=100"

# 2. PR reviews (all authors)
gh api repos/{owner}/{repo}/pulls/{PR}/reviews

# 3. Inline diff comments (all authors)
gh api repos/{owner}/{repo}/pulls/{PR}/comments

# 4. Comments Outside Diff — parse the most-recent Greptile summary comment body for
#    <details><summary><h3>Comments Outside Diff</h3> block when that block exists.
#    Extract each numbered item: file path, line(s), title, description. These have
#    NO comment ID — they live only in the summary comment body. Mark source: "outside-diff".
```

For Greptile's summary specifically, Greptile **edits a single summary comment in place**, so select the most-recently-`updated_at` Greptile comment, not the most-recently-created.

Parse for:
- **Unresolved inline comments** from every author — plus any actionable items in a Greptile summary's "Prompt to fix all with AI" section, **even if the inline endpoint returns zero**.
- **Outside-diff items** — numbered items extracted from the `<details>...Comments Outside Diff...` block; treat as unresolved until addressed.
- **Greptile confidence** (when present) — pattern like `4/5` or `Confidence: 5/5`. Informational for Phase 1: Phase 1 exits on unresolved-item count, not on score alone. Phase 2 watch treats **5/5** as `greptile_max` and stops.

Skip our own replies and already-resolved threads.

### D. Classify and exit conditions

For each unresolved item, classify:

| Class | Action |
| --- | --- |
| actionable | code change |
| informational / false-positive | push back in-thread; do not churn |
| already-fixed | reply with the sha; resolve |

Stop Phase 1 if **either** holds:
- zero unresolved items remain (every author), or
- iteration count reached `--max` (report remaining).

On Phase 1 exit, **release the wrap gate** (see "Release the gate" below) by writing `greptile.status: "done"` into the session `wrap.json` when the loop settled (including "no Greptile, other authors clean"), or `"skipped"` when Greptile is unavailable **and** there were no other-author items to handle. greploop is the SOLE writer of `greptile.status` — the Stop-hook gate (`hooks/greploop-gate.js`) blocks the session from finishing until this is recorded.

Then proceed to **Phase 2**.

### E. Fix actionable comments

Default: auto-fix actionable comments from the **configured external bot**
(Greptile) only. Human and other-author comments are classified, tagged, and
replied to; they are not edited unless `--fix-humans`. Skip this whole step
under `--no-fix`.

For each unresolved actionable **bot** comment — inline and outside-diff:
1. Read the file and understand the comment in context (read the full file, not just the diff).
2. Decide: actionable (code change) vs informational / false-positive.
3. If actionable, make the fix. For a substantial multi-file change, prefer spawning an `engineer` (`subagent_type: "engineer"`, `name: "engineer-vosler"` per `reference/roster.md`, `mode: "bypassPermissions"`) rather than editing inline.

### F. Commit + push (push BEFORE replying)

```bash
git add -A
git commit -m "{TICKET}: address review comments (greploop iter N)"   # no AI co-author trailer
git push
```

### G. Reply in-thread + resolve

**Inline comments** — post an in-thread reply tagging the author. Greptile → `@greptileai` (tone from `GORKHALI_GREPTILE_TONE`). Anyone else → `@<login>`:

```bash
gh api repos/{owner}/{repo}/pulls/{PR}/comments/{COMMENT_ID}/replies \
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

Use the same tag rules as inline. Always end each Greptile entry with `@greptileai`.

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

After posting the fallback `@greptileai review` (section A), if poll B still finds **no Greptile check-run and no Greptile comment** after ~5 additional minutes, Greptile is not installed on this repo — greploop is on by default, but Greptile app coverage is per-repo. Do **not** keep re-triggering. Continue Phase 1 for every other author. If there are no other-author items either, report "Greptile unavailable on this repo — skipping greploop" and **release the wrap gate** (see "Release the gate" below) by writing `greptile.status: "skipped"` into the session `wrap.json`. Then still proceed to Phase 2 if the PR is open.

---

## Release the gate (write `greptile.status` to wrap.json)

The Stop-hook gate (`hooks/greploop-gate.js`) blocks the session from finishing while a live PR's `greptile.status` is missing/`pending`. At **both** Phase 1 exit points above, patch the session `wrap.json` to release it: `done` on successful completion (zero unresolved), `skipped` when Greptile is unavailable on the repo and there was nothing else to handle.

The wrap.json path MUST be resolved with the SAME gorkhali-paths helpers the gate reads with (`detectRepo` + `current-session/<repo>.json` ticket precedence + `sessionsDir`) so the write lands in the byte-identical file the gate checks — a hand-built `basename $(git rev-parse --show-toplevel)` path shards under the ticket name inside worktrees and the gate never releases. Non-blocking and fail-soft — a write failure must not error the loop:

```bash
# STATUS = "done" (Phase 1 settled) or "skipped" (Greptile unavailable, nothing else)
STATUS="done"
node -e '
  const fs=require("fs"), path=require("path");
  const root=process.env.CLAUDE_PLUGIN_ROOT
    || path.join(process.env.HOME,".claude","plugins","marketplaces","gorkhali");
  let pp; try{ pp=require(path.join(root,"scripts","lib","gorkhali-paths")); }
  catch(e){ process.exit(0); /* helper missing → fail-soft */ }
  try{
    const TICKET_RE=/[A-Z][A-Z0-9]+-\d+/;
    const repo=pp.detectRepo();
    let ticket=null;
    try{ const s=JSON.parse(fs.readFileSync(path.join(pp.stateDir(),"current-session",repo+".json"),"utf8"));
      const focusTaskId=(s&&s.schema_version===2&&typeof s.focus_task_id==="string")?s.focus_task_id
        :(s&&s.schema_version===1&&typeof s.task_id==="string")?s.task_id:null;
      if(typeof focusTaskId==="string"&&TICKET_RE.test(focusTaskId)) ticket=focusTaskId.match(TICKET_RE)[0]; }catch(_){}
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

## Phase 2. Arm CHIEF_PING watch

After Phase 1 releases the gate, arm the standing watch. Do not ask.

1. Write `{SESSION_DIR}/pr-watch.json` with keys **only** `pr`, `status` (`watching`), `tick` (`0`), `watermark` (RFC3339, newest seen comment timestamp or now), `lastPingAt` (now). See `reference/schemas/pr-watch.md`. Extra keys are illegal.
2. Run **one** watch tick: `node "$PR/scripts/lib/pr-watch-tick.js" --watch-file "{SESSION_DIR}/pr-watch.json"` (resolve `$PR` the same way commands do). The script classifies GitHub and emits `CHIEF_PING`. Empty `$PR` or non-zero CLI → failed tick; no hand-typed block. Boolean `{new:false}` is illegal.
3. If the ping is `ack_stop` (`threads_clean`, `greptile_max`, merged, closed, ceiling), the script already wrote `status: stopped`. Do not re-arm. Spawn `clerk-herald` only on `ack_assess`.
4. Chief MUST `CHIEF_ACK` then `ack_rearm` / `ack_assess` / `ack_stop`.

Host interval: `PR_WATCH_INTERVAL_SECONDS` (120). Tick ceiling: `PR_WATCH_TICK_CEILING` (60). Early stop: all threads resolved **or** Greptile 5/5. Never merge.

---

## 3. Report

| Field | Value |
| --- | --- |
| PR | #{number} |
| Phase 1 iterations | N |
| Remaining comments | N (if any) |
| Watch | watching / paused / stopped |

```
Greploop complete.
  PR:          #1234
  Iterations:  2
  Remaining:   0
  Watch:       stopped
```

If stopped at `--max` with work left, list the remaining items (`path:line — "comment"`) and suggest next steps. greploop never merges the PR — merging stays a human action.
