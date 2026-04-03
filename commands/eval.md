---
name: team:eval
description: Evaluate crew performance with rubric
---

> Load `_shared.md` + `_shared-crew.md` before executing.

# /team:eval

Evaluate crew performance using the rubric from `.claude/evals/evaluation.md`.

Score each active agent 1-5 with confidence (high/medium/low):

- **Luffy**: plan clarity, crew selection, decomposition quality, contract completeness
- **Franky**: architecture clarity, pattern reuse, type safety, separation of concerns
- **Nami**: accessibility, responsive behavior, state completeness, design consistency
- **Sanji**: API contract fidelity, error handling, hook consistency, request/response typing
- **Zoro**: contract coverage, state coverage, interaction coverage, a11y checks
- **Chopper**: verification completeness, integration wiring, no business-logic drift, signal quality
- **Robin**: documentation usefulness, ADR clarity, Storybook coverage, example accuracy
- **Roger**: KISS/DRY enforcement, TypeScript strictness, pattern compliance, risk call accuracy

Record in session file. Use to improve crew assignment in future sessions.
