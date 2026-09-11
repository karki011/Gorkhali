---
name: gorkhali
description: Plan, execute, verify, independently review, pause, resume, and safely ship software-development work. Use for features, fixes, refactors, investigations, planning, implementation, review, verification, recovery, or progress checks.
---

# Gorkhali

Gorkhali ships software work by delegating each task to a subagent under a
hook that blocks the lead from editing code directly, with a model tier
chosen per role. Every task gets an independent, read-only check before it
counts as done, and a plan only moves to execution after you approve it in
chat. Once a pull request opens, review runs through to merge without you
having to drive each round yourself.

## Route the request

Read the request, then hand it to one command:

- **New work** - a ticket key, "implement", "build", "fix", "work on X":
  `start`. Covers exploring directions, gathering context, planning, and
  dispatching the tasks, all as one flow.
- **Continue prior work** - "resume", "pick up where we left off": `resume`.
- **Run checks** - tests, build, lint, correctness: `verify`.
- **Verification failed and the cause is known** - broken test, red build:
  `fix`.
- **Independent look at your verified diff**: `review`.
- **Ready to ship** - open the pull request: `wrap`. It hands off to
  `greploop` once the pull request exists.
- **Drive a pull request through review** - classify comments, resolve
  them, watch for replies: `greploop`.
- **A pull request merged** - close the ticket, archive the session: `close`.
- **Progress check** - "what are we working on", "where are we": `status`.
- **Stepping away** - "pause", "checkpoint": `pause`.
- **Worth remembering** - a correction, a pattern, a gotcha: `learn`.
- **UI change needs a human look**: `visual`.

If the request is ambiguous, ask which of these it means rather than
guessing.
