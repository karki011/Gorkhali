---
name: eval
description: "Use when you want to evaluate agent performance or score session quality — 'how did that go', 'rate the work'. Rubric-based evaluation of agent outputs, coordination, outcome quality."
# Conversational triggers ('how did that go') are intentionally muted by user-invocable:false — eval is an orchestration step, not auto-selected from NL. Do not flip this flag without re-checking auto-dispatch safety ('how did that go' is filler that would over-fire if invocable).
user-invocable: false
---

> **Preamble Tier: T2** — shared contexts per the canonical registry (`scripts/preamble-tier.js`); `_shared-detective.md` also loads on the detective trigger

# /phantom:eval

Evaluate shadows performance using the rubric from `.claude/evals/evaluation.md`.

Score each active agent 1-5 with confidence (high/medium/low):

- **Chief**: plan clarity, shadows selection, decomposition quality, contract completeness
- **Engineer (React Arch focus)**: architecture clarity, pattern reuse, type safety, separation of concerns
- **Engineer (UI focus)**: accessibility, responsive behavior, state completeness, design consistency
- **Engineer (API focus)**: API contract fidelity, error handling, hook consistency, request/response typing
- **Inspector (test)**: contract coverage, state coverage, interaction coverage, a11y checks
- **Inspector (build)**: verification completeness, integration wiring, no business-logic drift, signal quality
- **Engineer (Documentation focus)**: documentation usefulness, ADR clarity, Storybook coverage, example accuracy
- **Auditor**: KISS/DRY enforcement, TypeScript strictness, pattern compliance, risk call accuracy

Record in session file. Write the human-facing deliverable to `sessions/{TICKET}/eval.html`, authored from `reference/eval/eval-template.md` — this is the eval's actual output, not the session-file record. Use to improve shadows assignment in future sessions.
