---
name: greploop
description: "Use when driving a PR through all-author review — classify, tag, resolve, then arm CHIEF_PING watch. Auto-invoked by gorkhali:wrap after PR creation."
allowed-tools: ["Agent", "Read", "Edit", "Bash", "Grep", "Glob", "LS"]
# User-invocable (default) - typed /gorkhali:greploop resolves here. The same-named skill (skills/greploop/SKILL.md) carries user-invocable: false to stay off the / menu; this command remains the canonical procedure and the single menu surface. Do not flip without re-checking menu duplication.
---

> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger

# /gorkhali:greploop $ARGUMENTS

Drive a GitHub PR through **all-author** review, then arm the standing watch.
Phase 1 classifies, tags, and resolves review comments from every author.
Greptile comments still end with `@greptileai`. Other authors are tagged `@<login>`.
Phase 2 arms `CHIEF_PING` watch (`reference/pr-watch.md`).
Always on, fail-open, bounded. Auto-invoked by `gorkhali:wrap` after the PR is created.
READ `reference/greploop.md` for the full protocol (conventions, poll/trigger details, classify/tag/resolve, gate release).

Never merge. Never ask whether to run.

## Skeleton

0. **Identify the PR** — detect for current branch (or use the passed PR number); stop if none.
1. **Phase 1 — all-author classify / tag / resolve** (max `--max`, default `REVIEW_LOOP_MAX` = 5 from `scripts/lib/constants.js`):
   - A. Push and let reviews land (Greptile auto-reviews; guarded `@greptileai review` fallback only).
   - B. Poll the Greptile check-run to completion when a Greptile run is in flight.
   - C. Fetch review results from ALL authors — issue comments, reviews, inline, outside-diff. Do not filter to Greptile.
   - D. Classify each unresolved item (actionable / informational / false-positive). Exit Phase 1 when none remain or `--max` reached.
   - E. Fix actionable comments (skip under `--no-fix`). Substantial multi-file change: spawn `subagent_type: "engineer"`, `name: "engineer-vosler"`.
   - F. Commit + push (push BEFORE replying).
   - G. Reply in-thread tagging the author (`@greptileai` when Greptile; otherwise `@<login>`), resolve threads, loop back to A.
2. **Phase 2 — arm watch** — write `{SESSION_DIR}/pr-watch.json` (`status: watching`) and run the first `CHIEF_PING` tick per `reference/pr-watch.md` (`subagent_type: "clerk"`, `name: "clerk-herald"`).
3. **Report** — PR, iterations, remaining, watch status.

On Phase 1 exit (success or Greptile unavailable), **release the wrap gate** by writing `greptile.status` to the session `wrap.json` (`done` | `skipped`) — greploop is the SOLE writer; `hooks/greploop-gate.js` blocks the session until it lands. Never merges the PR — merging stays a human action.
