---
name: greploop
description: "Use when you want to drive a PR to a perfect Greptile review — iteratively trigger Greptile, fix every actionable comment, resolve threads, re-review, and repeat until 5/5 confidence with zero unresolved comments. Also use when user says 'greploop', 'loop greptile', 'get this to 5/5', 'clear all greptile comments', or 'optimize the PR against review'. Auto-invoked by phantom:wrap after a draft PR is created."
allowed-tools: ["Read", "Edit", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:greploop $ARGUMENTS

Iteratively fix a GitHub PR until Greptile gives a perfect review: **5/5 confidence, zero unresolved comments**.
Always on, fail-open, bounded. Auto-invoked by `phantom:wrap` after a draft PR is created.
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
   - G. Reply in-thread in tone (`PHANTOM_GREPTILE_TONE`), resolve threads, loop back to A.
2. **Report** — PR, iterations, final confidence, resolved/remaining.

On exit (success or Greptile unavailable), **release the wrap gate** by writing `greptile.status` to the
session `wrap.json` (`done` | `skipped`) — greploop is the SOLE writer; `hooks/greploop-gate.js` blocks
the session until it lands. Never marks the PR ready-to-review — that stays a human action.
