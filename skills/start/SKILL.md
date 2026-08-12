---
name: start
description: Start Phantom planning or implementation for a feature, fix, refactor, investigation, or other software task. Use when the user asks to build, implement, fix, plan, or resume work.
---

# Start Phantom

Treat the invocation text as the task intent. Read `../phantom/SKILL.md` and
follow its portable router as the workflow authority.

For a normal start:

1. Inspect compact durable status and resume a matching active session.
2. Read repository instructions and relevant learnings, then gather bounded
   code, dependency, and risk evidence.
3. Classify the route and load `../phantom/references/planning.md`.
4. Persist the route and plan artifacts through the portable state helper.
5. Stop at every required approval or authorization boundary.

This adapter covers local planning and implementation only. Implementation
authorization remains explicit. This adapter has no implicit PR lifecycle:
draft-PR shipping requires separate, explicit authorization. It never implies
authority to push, transition a ticket, merge, clean up, or perform another
external lifecycle action.

Provider compatibility surfaces remain installed for older callers, but they
are not part of normal start activation and cannot override the portable
router, its state engine, or user and repository instructions.
