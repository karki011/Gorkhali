---
name: greploop
description: "Use when driving a PR to a perfect Greptile review — trigger Greptile, fix every comment, resolve threads, repeat until 5/5 with zero unresolved. Auto-invoked by gorkhali:wrap after PR creation."
allowed-tools: ["Read", "Edit", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger

# /gorkhali:greploop $ARGUMENTS

Iteratively fix a GitHub PR until Greptile gives a perfect review: **5/5 confidence, zero unresolved comments**.
Always on, fail-open, bounded. Auto-invoked by `gorkhali:wrap` after the PR is created.
READ `reference/greploop.md` for the full protocol (conventions, poll/trigger details, comment triage, gate release).

## Skeleton

0. **Identify the PR** — detect for current branch (or use the passed PR number); stop if none.
1. **Loop** (max `--max`, default 5):
   - A. Push and let Greptile review (guarded `@greptileai review` fallback only).
   - B. Poll the Greptile check-run to completion.
   - C. Fetch review results — check ALL sources (latest-`updated_at` summary, reviews, inline, outside-diff).
   - D. Exit when 5/5 + zero unresolved + zero outside-diff, or `--max` reached.
   - E. Fix actionable comments (skip under `--no-fix`).
   - F. Commit + push (push BEFORE replying).
   - G. Reply in-thread in tone (`GORKHALI_GREPTILE_TONE`), resolve threads, loop back to A.
2. **Report** — PR, iterations, final confidence, resolved/remaining.

On exit (success or Greptile unavailable), **release the wrap gate** by writing `greptile.status` to the
session `wrap.json` (`done` | `skipped`) — greploop is the SOLE writer; `hooks/greploop-gate.js` blocks
the session until it lands. Never merges the PR — merging stays a human action.
