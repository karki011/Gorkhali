---
name: greploop
description: "Use when driving a PR through all-author review — classify, tag, resolve, then arm CHIEF_PING watch. Auto-invoked by gorkhali:wrap after PR creation."
allowed-tools: ["Agent", "Read", "Edit", "Bash", "Grep", "Glob", "LS"]
# Hidden from the Claude Code / menu to deduplicate entries — the same-named skill is the single menu surface and delegates to this command, which remains the canonical procedure. Do not flip without re-checking menu duplication.
user-invocable: false
---

> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger

# /gorkhali:greploop $ARGUMENTS

Drive a GitHub PR through **all-author** review, then arm the standing watch.
Phase 1 classifies, tags, and resolves review comments from every author.
Greptile comments still end with `@greptileai`. Other authors are tagged `@<login>`.
Phase 2 arms `CHIEF_PING` watch (`reference/pr-watch.md`).
Always invoked from wrap, fail-open, bounded. Greploop probes `review.external`
and Greptile availability before looping; it may write `skipped` and stop.
Auto-invoked by `gorkhali:wrap` after the PR is created.
READ `reference/greploop.md` for the full protocol (conventions, poll/trigger details, classify/tag/resolve, gate release).

Never merge. Never ask whether to run — wrap already invoked you. You may skip
after the capability probe.

## Skeleton

0. **Identify the PR** — detect for current branch (or use the passed PR number); stop if none.
0.5. **Probe capability** — `node scripts/gorkhali-config.js get review.external --repo <workspace> --json`. If the value is `none`, or the key is unset and no Greptile check-run exists on the PR, write `greptile.status: skipped`, say so, skip Phase 1, and still release the wrap gate. Do not invent a pass. When `greptile` is configured or detected, continue; do not ask.
1. **Phase 1 — all-author classify / tag / resolve** (max `--max`, default `REVIEW_LOOP_MAX` = 5 from `scripts/lib/constants.js`):
   - A. Push and let reviews land (Greptile auto-reviews; guarded `@greptileai review` fallback only).
   - B. Poll the Greptile check-run to completion when a Greptile run is in flight.
   - C. Fetch review results from ALL authors — issue comments, reviews, inline, outside-diff. Do not filter to Greptile.
   - D. Classify each unresolved item (actionable / informational / false-positive). Exit Phase 1 when none remain or `--max` reached.
   - E. Auto-fix actionable comments from the configured external bot only. Human and other-author comments: classify, tag, reply — do not edit unless `--fix-humans`. `--no-fix` skips all edits. Substantial multi-file bot fix: spawn `subagent_type: "engineer"`, `name: "engineer-vosler"`.
   - F. Commit + push (push BEFORE replying) only when a fix landed.
   - G. Reply in-thread tagging the author (`@greptileai` when Greptile; otherwise `@<login>`), resolve threads, loop back to A.
2. **Phase 2 — arm watch** — write `{SESSION_DIR}/pr-watch.json` (`status: watching`) and run `{PR_BOOTSTRAP}; node "$PR/scripts/lib/pr-watch-tick.js" --watch-file "{SESSION_DIR}/pr-watch.json"` (empty `$PR` or non-zero CLI → failed tick; no hand-typed block). The script emits `CHIEF_PING` and stops on resolved threads or Greptile 5/5. Spawn `subagent_type: "clerk"`, `name: "clerk-herald"` only on `ack_assess`.
3. **Report** — PR, iterations, remaining, watch status.

On Phase 1 exit (success or Greptile unavailable), **release the wrap gate** by writing `greptile.status` to the session `wrap.json` (`done` | `skipped`) — greploop is the SOLE writer; `hooks/greploop-gate.js` blocks the session until it lands. Never merges the PR — merging stays a human action.
