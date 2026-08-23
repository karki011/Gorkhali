# Usage-Budget Guard

Author: Subash Karki

> Advisory, NOT a hard hook. Conservative pre-flight check before a BIG fan-out wave —
> stop starting work that will get cut off mid-flight.

## When to check

Before launching a BIG fan-out (many parallel agents, a large workflow, a wide execute wave).
Skip for small/solo work — overhead not worth it.

## The check

Before dispatch, glance at remaining usage budget (context window, rate/usage limits, any
session cap the harness surfaces). Near the limit (~95% consumed) → do NOT start the wave.
A wave cut off mid-flight leaves half-merged worktrees and orphaned agent state.

## When near the limit — pause cleanly

1. Do NOT spawn the wave.
2. Emit a self-contained **resume plan** the user can act on cold:
   - what's done so far (waves/tasks complete)
   - the exact next wave (agents + their scoped tasks + file targets)
   - where state lives (`{TEAM_DIR}/sessions/{TICKET}/` — plan.json, execution.json, checkpoints)
   - the single command to resume: `/gorkhali:resume {TICKET}`
3. Stop. Let the user resume in a fresh session with headroom.

## Notes

- Conservative by design — a false pause costs one `/gorkhali:resume`; a false start costs a
  cut-off wave.
- If budget is unknown/unavailable → proceed (never block on a missing signal).
- Single-shot / solo tasks → ignore this entirely.
