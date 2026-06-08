# Brainstorm Protocol

Loaded by Apex when router classifies task as `BRAINSTORM_PLAN` or `FULL`.
Purpose: DIVERGE → CONVERGE before planning begins. Output feeds `intent.json`.

---

## When to Activate

Trigger brainstorm if ANY of these are true:
- No clear file targets (vague goal, no codebase anchor)
- New domain — no learnings for this area, unfamiliar codebase section
- Architecture choice required (multiple valid structural approaches)
- User signal: "what if", "I'm thinking about", "how should we", "explore"

Skip brainstorm if scope is already clear — jump to planning.

---

## Question-Asking Rules

Before asking ANYTHING, check:
1. Does `CLAUDE.md` or project docs answer this?
2. Does the code graph / learnings / git history answer this?
3. Does the answer change WHAT is built (not HOW)?

If no to #3 → don't ask. If yes to #1 or #2 → don't ask, just use the answer.

**Ask only when the answer changes scope, technology choice, or integration contract.**

Format: batch 2–5 related questions in a single message.

Each question must include:
- The question
- Why it matters (scope impact)
- Recommended default
- Alternatives

Never ask: generic discovery ("what's your stack?"), things CLAUDE.md already defines, HOW questions (that's for planning).

---

## Exploration Protocol

Propose 2–3 approaches. Never more (analysis paralysis). Never fewer (false certainty).

Each approach:
```
Approach N: [name]
Summary:    [one sentence]
Pros:       [bullet list]
Cons:       [bullet list]
Complexity: [low | medium | high]
Risk:       [low | medium | high — with reason]
```

Before proposing: scan `learnings/INDEX.md`.
- `[failed]` entry matches → do NOT propose that approach. Flag it as "previously attempted and failed."
- `[validated:5+]` entry matches → surface it as the recommended default.

---

## Council Mode (anonymized peer-ranking + chairman synthesis)

> Borrowed from [karpathy/llm-council](https://github.com/karpathy/llm-council). Phantom is
> single-provider, so treat peer-rankings as a **self-consistency** signal, not independent
> validation — same-family agents share blind spots. Council costs ~2-3 + 2-3 + 1 spawns, so use it
> only when divergence is genuinely open. Measure the cost with `scripts/timing-report.js`.

**Use council when** the route is FULL, an architecture choice is in play, the problem is
high-uncertainty, or `--council` is passed. **Otherwise** the coordinator drafts the 2-3 approaches
directly (simple path, no extra spawns) and skips to Convergence.

**Step 1 — Independent generation.** Spawn 2-3 approach-generator Blades, each with a DISTINCT lens,
in parallel (`run_in_background: true`). Each produces exactly ONE candidate approach from the gathered
context, in the Exploration Protocol shape. Suggested lenses (pick per problem):
- `simplest` — least code/scope that solves the core problem (KISS/YAGNI)
- `robust` — risk-first: edge cases, failure modes, scale
- `reuse` — leans hardest on existing patterns/abstractions in this codebase

Generators are reasoning-heavy → Opus. Inject `[failed]` / `[validated:5+]` learnings into each prompt.

**Step 2 — Anonymized peer-ranking.** Apex relabels the candidates `Approach A / B / C`, stripping lens
and author identity. Spawn one ranker per candidate (fresh spawns) given the FULL anonymized set; each
ranks ALL candidates on **Fit / Risk / Simplicity** with a one-line justification each. No agent may
identify or favor "its own" — the anonymization is the point. Apex aggregates (average rank; ties broken
by lower Risk). Ranking is rubric-scoped → Apex may route rankers to Sonnet; default Opus.

**Step 3 — Chairman synthesis.** Spawn ONE Opus Chairman with the anonymized approaches + the aggregate
ranking. It produces: the **recommended** approach (may graft the winner's spine + the runners-up's best
ideas), the ranked alternatives, and a rationale citing the rankings. **The Chairman does NOT decide** —
its output feeds the human gate below.

---

## Convergence

1. Present approaches to human — the Chairman synthesis + peer-ranking summary (council), or the 2-3
   approaches (simple path).
2. Human picks one OR asks for more exploration (max 2 rounds total).
3. On decision → write to `intent.json`:
   - `approach`: chosen approach name
   - `scopeDecisions`: key constraints and choices made
   - `exploredAlternatives`: what was ruled out and why
4. Hand off to Plan phase. Planner reads `intent.json` and does NOT re-brainstorm.

Scope guardrail: **clarifying ambiguity ≠ adding features.**
If a question would expand scope, flag it as out-of-scope and stop.

---

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Asking what CLAUDE.md already defines | Wastes turns, erodes trust |
| Brainstorming when scope is clear | Delays execution for no value |
| Proposing >3 approaches | User paralysis, Apex overload |
| Re-brainstorming in planning phase | Breaks diverge/converge contract |
| Letting exploration expand scope | Brainstorm becomes scope creep |
| Skipping learnings check | Repeats past failures |

---

Author: Subash Karki
