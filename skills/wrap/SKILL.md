---
name: wrap
description: Finalize verified Phantom work and, when explicitly authorized, request an idempotent draft pull request. Use for wrap up, an authorized draft PR, or final session handoff.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `wrap`.

Treat invocation text as action input. Finalize current evidence and session
state only after the portable completion gate passes. A draft pull request
requires separate `ship-draft-pr` authorization bound to current artifacts and
an idempotent capability request. Commit, push, ticket, and other external
actions are never implied.
