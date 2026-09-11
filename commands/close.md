---
name: close
description: "Use when a PR has MERGED and you want to close out the ticket - tracker to done, clean up the branch and worktree. Shipping a PR: gorkhali:wrap. Review still open: gorkhali:greploop."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
user-invocable: true
---

# /gorkhali:close

Post-merge closeout. Safe to re-run: a step that finds its work already done
reports that and moves on rather than failing.

## 1. Confirm merged

Resolve the PR from the current branch or the active session. Run
`gh pr view <number> --json state,mergedAt,mergeCommit,headRefName`.
Anything other than `MERGED` stops here: state the actual PR state, and
point to `/gorkhali:greploop` if review is still open.

## 2. Tracker done

Resolve the tracker adapter (`lib/tracker.js`) and run its `done` and
`comment` descriptors for the ticket, noting the PR number and merge commit
in the comment. A `none` provider makes both a no-op - say so, do not block.

## 3. Clean up

Delete the local and remote copies of `headRefName`. If a worktree was used
for this task, remove it too. Skip cleanly whatever is already gone; log
each action and its result.

## 4. Report

One line: ticket, PR number, merge commit, tracker result, cleanup result.
The session directory stays exactly where `lib/session.js` put it - nothing
here archives or deletes it.
