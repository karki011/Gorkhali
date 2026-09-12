---
name: gorkhali
user-invocable: false
description: Plan, delegate, verify, pause, resume, and ship engineering work with Claude Code. Use for features, fixes, refactors, investigations, review, recovery, or progress checks.
---

# Gorkhali

One orchestrator, three normal roles: Engineer implements, Inspector checks,
Auditor independently judges the integrated diff. Read `../../references/lifecycle.md`.
Claude Code is the only supported host. Planning belongs to the orchestrator;
there is no additional Planner agent.

Route natural language to the following public commands:

- New work, including obvious bugs: `start`.
- Continue interrupted work: `resume`.
- Checks, semantic review, repair, or a user-visible checklist: `verify`.
- Open a PR or continue its external review: `wrap`.
- After human merge: `close`.
- Progress: `status`.
- Stop with a structured handoff: `pause`.
- Explicitly save a durable preference: `learn`.

Use the smallest coherent plan. Every implementation plan needs explicit
approval, including quick work; approval already given for this exact plan
counts. Resume does not ask again unless scope or dependencies changed.
Opposition is conditional on ambiguity or high risk. Detective is conditional
on diagnosis evidence. Neither is a normal-path seat.

The lead never implements through editing tools or shell scripts. Use the
bounded lifecycle CLI for state and integration. Delegate implementation,
including integration conflict resolution, to Engineer. Merge stays human.
