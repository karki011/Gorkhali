---
name: team:eval
description: Evaluate crew performance with rubric
---

> **Preamble Tier: T2** — loads '_shared.md' + '_shared-repo-detection.md' + '_shared-auto-learning.md'

# /team:eval

Evaluate crew performance using the rubric from `.claude/evals/evaluation.md`.

Score each active agent 1-5 with confidence (high/medium/low):

- **Cortex**: plan clarity, crew selection, decomposition quality, contract completeness
- **Spark (React Arch focus)**: architecture clarity, pattern reuse, type safety, separation of concerns
- **Spark (UI focus)**: accessibility, responsive behavior, state completeness, design consistency
- **Spark (API focus)**: API contract fidelity, error handling, hook consistency, request/response typing
- **Sentinel (test)**: contract coverage, state coverage, interaction coverage, a11y checks
- **Sentinel (build)**: verification completeness, integration wiring, no business-logic drift, signal quality
- **Spark (Documentation focus)**: documentation usefulness, ADR clarity, Storybook coverage, example accuracy
- **Prism**: KISS/DRY enforcement, TypeScript strictness, pattern compliance, risk call accuracy

Record in session file. Use to improve crew assignment in future sessions.
