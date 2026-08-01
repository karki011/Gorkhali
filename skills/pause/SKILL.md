---
name: pause
description: Pause, checkpoint, or save in-progress Phantom session state before a meeting, context switch, or break without performing git operations.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `pause`.

Treat invocation text as action input. Persist the current route, fingerprints,
evidence, decisions, blockers, and next safe action through the portable state
helper. Do not perform git or external lifecycle actions.
