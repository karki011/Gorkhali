---
name: hound
description: Investigate unknown causes of bugs, regressions, wrong behavior, and mysterious failures, producing a forensic report without guessing at fixes. Use when something is off, started after a change, or has no clear error; use fix for known failures.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `hound`.

Treat invocation text as action input. Reproduce the symptom, trace the exact
code path, record conflicting evidence, and write current defect proof. Stop at
the root-cause confirmation gate without implementing a repair.
