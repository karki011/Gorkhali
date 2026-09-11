---
name: greploop
description: "Drive a PR through all-author review - classify, fix, reply, resolve - until it is clean or a human has to decide. Invoked by gorkhali:wrap after PR creation."
allowed-tools: ["Agent", "Read", "Edit", "Bash", "Grep", "Glob", "LS"]
user-invocable: true
---

# /gorkhali:greploop $ARGUMENTS

Drive the PR wrap opened through review from every author, not just one
bot, until it is clean or a human has to decide. Never merge - merging is
always a human action.

## Loop

After wrap opens the PR, and again between every round below, wait for the
external review check to complete or a fixed 3-minute interval, whichever
comes first, before calling `tick` - an idle tick with zero new items taken
right after the PR opens does not consume a round.

Call `tick(prNumber)` from `lib/pr-watch.js`. `stop: true` with
`reason: merged` or `closed` ends the loop - report and stop. `reason:
clean` (every thread resolved) also ends it cleanly.

Otherwise, classify every item `tick` returned - `kind: 'thread'`, `'review'`,
or `'comment'` alike; a review or comment already carries its `body` and
`author`, an open thread's comment text and author still need a fetch:

- **actionable** - a real problem stated clearly enough to fix.
- **informational** - worth reading, nothing to change.
- **false-positive** - wrong, or already handled.

## Fix, reply, resolve

An actionable comment from the external reviewer named in preferences
(a `reviewer: <login>` line) may be fixed directly by one Engineer in this
same worktree. An actionable comment from anyone else - a human, or a bot
preferences does not name - gets a reply and a tag, never an automatic
edit. Push any fix before replying. Reply on every classified item, tagging
its author; a thread also gets resolved after the reply, a top-level review
or issue comment has no resolve action so a reply is the whole response.
Loop back to `tick` after each pass, waiting the same 3-minute interval
first.

Stop after five rounds even if items remain; report exactly what is left
and why.

## Human decisions

The moment a thread needs a human call - disagreement, an ambiguous fix, no
configured reviewer to auto-fix an actionable bot comment - stop looping,
say what needs a decision in chat, and note it stays visible on
`/gorkhali:status` until resolved.
