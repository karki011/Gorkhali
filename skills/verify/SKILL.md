---
name: verify
description: Run correctness checks for a Phantom workflow, including tests, builds, and lint; use when asked to verify changes, run tests, check the build, lint, or confirm the build is green, not to repair known failures.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `verify`.

Treat invocation text as action input. Run the deterministic checks required by
the compiled node against the current fingerprint and record exact evidence.
Report every observed finding and missing capability. Do not repair failures or
perform lifecycle actions.
