---
name: execute
description: Execute an already approved Phantom workflow from its validated plan, contracts, dependencies, and authorization. Use execute for approved work, start for unplanned work, and resume for prior sessions.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `execute`.

Treat invocation text as action input. Pass the portable execute gate, then run
the compiled dependency graph with the smallest useful topology. Delegation is
optional and limited to independently useful scopes. Execution never grants or
performs shipping.
