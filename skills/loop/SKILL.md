---
name: loop
description: Run one read-only Mission Control triage pass over ready work and propose bounded next actions. Any implementation, ticket change, or remote mutation requires separate authorization.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `loop`.

Treat invocation text as action input. Inspect available work, classify route
and readiness, and return a bounded proposal. Do not implement, assign,
transition, comment, or otherwise mutate external work without a separately
authorized workflow and capability request.
