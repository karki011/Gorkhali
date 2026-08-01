---
name: validate
description: Retroactively audit a finished Phantom session for plan completeness and contract or requirements coverage; use for validating sessions, checking outputs against contracts, or confirming all requirements were covered, not for code review or test runs.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `validate`.

Treat invocation text as action input. Rebuild the expected workflow state from
recorded evidence, then report missing, contradictory, stale, or out-of-scope
artifacts against the accepted contract. This action is read-only.
