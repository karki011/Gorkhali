---
name: fix
description: Repair a confirmed failure inside an active Phantom session through a bounded evaluator loop. Use for known failing tests, builds, lint, or CI; use hound when the cause is unknown.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `fix`.

Treat invocation text as action input. Require current defect evidence and a
confirmed cause, apply one scoped repair, and let the bounded workflow evaluator
decide whether another iteration is legal. Stop on repeated failure class,
budget limit, or stale evidence.
