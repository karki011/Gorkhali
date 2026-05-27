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

## Convergence

1. Present approaches to human.
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
