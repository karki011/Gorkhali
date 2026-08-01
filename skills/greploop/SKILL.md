---
name: greploop
description: Assess Greptile feedback and, when separately authorized, apply bounded pull-request updates. Use to inspect Greptile review, plan fixes, or address authorized actionable comments.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `greploop`.

Treat invocation text as action input. Read current review evidence, classify
actionable findings, and use a bounded evaluator loop for authorized repairs.
Pushes, comments, thread resolution, and other remote mutations each pass
through an explicit idempotent capability request.
