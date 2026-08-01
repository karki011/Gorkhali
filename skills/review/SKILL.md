---
name: review
description: Review current code changes for quality, simplicity, duplication, architecture, and actionable diff findings; not for test execution or requirements validation.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `review`.

Treat invocation text as action input. Independently inspect the requested diff
and report every evidence-backed finding with severity, location, impact, and
smallest remediation. Keep the complete finding record separate from the
deterministic gate decision; do not repair or ship.
