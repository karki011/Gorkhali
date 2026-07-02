---
name: phantom:close
description: "Use when a PR has MERGED and you want to fully close out the ticket — move Jira to Done, finalize & archive the session, clean up the branch/worktree, record final cost. Also use when user says 'close it out', 'ticket merged', 'move to done', 'finish the session', 'close the session', 'clean up the branch', or 'archive the ticket'. NOT for shipping a PR (use phantom:wrap) — close is the post-merge terminal step that runs after merge."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T2** — loads `_shared.md` + repo-detection + auto-learning

# /phantom:close

Post-merge terminal closeout. Two hard principles: **(a) IDEMPOTENT** — safe to re-run; if already closed, report and exit cleanly. **(b) GUARDED** — a failure in any step never leaves a half-broken state; report what succeeded/failed and continue.

<execution>
## Runs on the pinned Warden agent

Close is 100% mechanical, so it runs on a fixed cheap model — not the session model. Resolve the ticket/session (Step 1) inline, then spawn **one** `warden` agent to execute Steps 2–6:

`Agent({ subagent_type: "warden", mode: "bypassPermissions", run_in_background: true })` — model + effort come from warden's definition (`sonnet`). Hand it the resolved `{TICKET}`, `pr.number`, `pr.url`, `jira.ticket`, and the session dir. Warden runs the merge gate → Jira → git cleanup → cost → artifact and reports per-step results. This skill then renders the SESSION CLOSED box from what warden returns.

If `warden` is unavailable (older install without the agent), fall back to running Steps 2–6 inline.
</execution>

## Step 1: Resolve Ticket + Session

Accept `{TICKET}` arg; else detect from `git branch --show-current` (branch name contains the ticket key) or active session directory.

Read `{TEAM_DIR}/sessions/{TICKET}/wrap.json`. Extract:
- `pr.number`, `pr.url` — the shipped PR
- `jira.ticket` — the Jira key (falls back to `{TICKET}` arg)

If `wrap.json` missing → **STOP**: "No shipped session for {TICKET} — run `/phantom:wrap` first."

If `{TEAM_DIR}/sessions/{TICKET}/close.json` exists and `status == "closed"` → report "Already closed." and exit (idempotent).

## Step 2: Merge Gate

Check PR state:
```bash
gh pr view {pr.number} --json state,mergedAt,mergeCommit,headRefName
```

- `state == "MERGED"` → proceed
- `state == "OPEN"` or `"DRAFT"` → **STOP**: "PR #{pr.number} is {state} — merge the PR first, or run `/phantom:greploop` if review is still in progress."
- Any other state → **STOP** with the actual state value.

## Step 3: Jira → Done

Running this command IS the authorization; no confirmation required. Honor config `jira.auto_transition` (skip transition if explicitly `false`).

Using the Atlassian MCP:
1. `getTransitionsForJiraIssue({ issueIdOrKey: jira.ticket })` — fetch valid transitions.
2. Find the transition whose name matches `Done` (case-insensitive); fall back to `Closed` or `Resolved` in that order.
3. If already in a terminal state (Done/Closed) → skip transition, note "already Done".
4. Otherwise `transitionJiraIssue(...)` to move it.
5. `addCommentToJiraIssue(...)` with: "PR #{pr.number} merged ({mergeCommit.oid[:8]}). Session closed via phantom:close. {pr.url}"

Guard: if Jira/MCP unavailable, log "Jira unavailable — skipping transition" and continue; do not block.

## Step 4: Git Cleanup

Act only on `headRefName` from the merge gate — never touch other branches.

```bash
# Delete local branch (ignore if already gone)
git branch -d {headRefName} 2>/dev/null || git branch -D {headRefName} 2>/dev/null || true

# Delete remote branch (ignore if already gone)
git push origin --delete {headRefName} 2>/dev/null || true
```

If a worktree was used for this ticket (check `git worktree list` for `{headRefName}` or `{TICKET}`):
```bash
git worktree remove --force {worktree_path} 2>/dev/null || true
git worktree prune
```

Skip cleanly if branch/worktree already gone. Log each action and result.

Then clear this session's wake state (the pointer is per-repo — resolve the repo name the same way `start` wrote it, bare-pointer fallback included): `S="{TEAM_DIR}/sessions/{TICKET}"; rm -f "$S/.wake-queue" "$S/.wake-queue.seq" "$S/.triage-log"; PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"; REPO="$([ -n "$PR" ] && node -e 'process.stdout.write(require(process.argv[1]+"/scripts/lib/phantom-paths").detectRepo())' "$PR" 2>/dev/null || true)"; P="${PHANTOM_DATA:-$HOME/.claude/phantom-data}/state/.active-wake-session${REPO:+.$REPO}"; [ "$(cat "$P" 2>/dev/null)" = "$S" ] && rm -f "$P" || true` — only clears the pointer when it still points at this session.

## Step 5: Cost Finalize

```bash
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
[ -n "$PR" ] && node "$PR/scripts/cost-link.js" close {TICKET}
[ -n "$PR" ] && node "$PR/scripts/cost-report.js" {TICKET}
```

Capture the report's `Total:` line for the output box. Never blocks — empty `$PR` (no plugin cache) → guards skip both silently.

## Step 6: Enrich Brain Card

The wrap emitted a Repo Brain card with an empty `trace.commit` (the merge commit didn't exist yet). Now that the PR is merged, backfill `trace.pr` + `trace.commit` on that card (schema: `reference/brain.md`). The card's `status` stays `active` — supersession is a separate lifecycle handled by evolution, not close.

Read `brainCard.id` from wrap.json (skip cleanly if absent/`null`). Enrich as a **guarded RUN** — a card failure NEVER blocks the close:

```bash
PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
REPO="$(node -e 'process.stdout.write(require(process.argv[1]+"/scripts/lib/phantom-paths").detectRepo())' "$PR" 2>/dev/null || true)"
CARD_ID="{brainCard.id from wrap.json}"
[ -n "$PR" ] && [ -n "$REPO" ] && [ -n "$CARD_ID" ] && node -e '
  const b = require(process.argv[1] + "/scripts/lib/brain-card");
  const [, root, repo, id, prurl, commit] = process.argv;
  const c = b.readCard(repo, id);
  if (!c) process.exit(0);
  if (prurl) c.trace.pr = prurl;
  if (commit) c.trace.commit = commit;
  b.writeCard(c, { repo });
' "$PR" "$REPO" "$CARD_ID" "{pr.url}" "{mergeCommit.oid}" || true
```

## Step 7: Write Close Artifact

Write `{TEAM_DIR}/sessions/{TICKET}/close.json`:

<output_format>
```json
{
  "_meta": {
    "writtenAt": "{ISO 8601 now}",
    "gitHead": "{current HEAD sha}",
    "phase": "close",
    "skill": "phantom:close",
    "version": 1
  },
  "ticket": "{TICKET}",
  "status": "closed",
  "pr": {
    "number": "{pr.number}",
    "url": "{pr.url}",
    "mergedAt": "{mergedAt}",
    "mergeCommit": "{mergeCommit.oid}"
  },
  "jira": {
    "ticket": "{jira.ticket}",
    "transitioned": true,
    "targetState": "Done",
    "result": "transitioned | already_done | skipped | unavailable"
  },
  "cleanup": {
    "branchDeleted": true,
    "worktreeRemoved": false,
    "notes": "{any skip/error messages}"
  },
  "cost": {
    "total": "{cost-report Total line}"
  }
}
```
</output_format>

## Step 8: Future Autonomy Note

Full autonomy — a Mission Control watcher that auto-fires `phantom:close` on merge and advances the ticket queue — is a future layer. This manual skill is the primitive it will call.

---

> **Output:** SESSION CLOSED box with Ticket, PR # + merge commit, Jira → Done, Branch/worktree cleaned, Final AI Cost. Random sign-off.
