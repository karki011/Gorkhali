---
name: wire
description: Map dependency topology from an approved Phantom plan, including execution waves, integration points, ordering, shared files, and risks; use after plan approval or when asked to wire tasks or show implementation dependencies.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `wire`.

Treat invocation text as action input. Derive dependencies, shared-write risks,
producer-consumer edges, integration ownership, and legal execution waves from
observed evidence. Partial dependency coverage cannot authorize parallel work.
