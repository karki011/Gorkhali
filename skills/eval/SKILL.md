---
name: eval
description: Evaluate agent performance and session quality with rubric-based scores for outputs, coordination, verification, and outcomes. Use to rate the work, score a session, review shadow effectiveness, or assess how a run went.
---
Read `../phantom/SKILL.md` completely and apply its contracts directly.

Portable action: `eval`.

Treat invocation text as action input. Evaluate only recorded artifacts and
observed evidence against an explicit rubric. Report all supported severities;
keep acceptance filtering separate, and never infer missing evidence as a pass.
