---
name: resume
description: Resume, restore, or continue prior Phantom work from a paused session or earlier context using its saved state and plan.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `resume`.

Treat invocation text as action input. Restore the matching portable session,
validate workspace and artifact fingerprints, and continue from the first legal
incomplete node. Reuse only authorization still bound to current intent and
artifacts.
