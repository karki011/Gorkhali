---
name: start
description: Start net-new Gorkhali planning or implementation for a feature, fix, refactor, or investigation; NOT for approved plans (execute) or prior sessions (resume).
---

# Start Gorkhali

## Triggers

Start Gorkhali planning or implementation for a feature, fix, refactor, investigation, or other software task. Use when the user asks to build, implement, fix, or plan work.

Treat the invocation text as the task intent. Read `../gorkhali/SKILL.md` and
follow its portable router as the workflow authority.

For a normal start:

1. Inspect compact durable status and resume a matching active session.
2. Read repository instructions and relevant learnings, then gather bounded
   code, dependency, and risk evidence.
3. Classify the route and load `../gorkhali/references/planning.md`.
4. Persist the route and plan artifacts through the portable state helper.
5. Stop at every required approval or authorization boundary.

This adapter covers local planning and implementation only. Implementation
authorization remains explicit. This adapter has no implicit PR lifecycle:
PR shipping requires separate, explicit authorization (legacy scope name
`ship-draft-pr`). It never implies
authority to push, transition a ticket, merge, clean up, or perform another
external lifecycle action.

Provider compatibility surfaces remain installed for older callers, but they
are not part of normal start activation and cannot override the portable
router, its state engine, or user and repository instructions.
