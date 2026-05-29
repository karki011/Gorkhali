# Deliberation Protocol

Planner (Apex) and Challenger (Rival, opus, no tools) deliberate **before** presenting to human.

## Round Flow
- Round 1: Planner sends plan -> Challenger returns verdict (PROCEED / REVISE / RETHINK)
- If PROCEED -> present to human immediately
- If REVISE/RETHINK -> Planner revises, Round 2
- Round 2: Planner sends revised plan -> Challenger returns verdict
- After Round 2: ALWAYS present to human (max 2 rounds, never 3)

## Presentation to Human

| Outcome | Human Sees |
|---------|------------|
| Consensus (PROCEED) | Unified plan: "Plan reviewed by Rival (PROCEED). Ready to execute?" |
| Partial (REVISE after R2) | Plan with annotated unresolved concerns. Human decides per point. |
| Disagreement (RETHINK after R2) | Two approaches side-by-side. Human picks A, B, or "neither." |

## Challenger Constraints
- Max 5 challenges per round, max 100 words each
- Must cite specifics: task numbers, file paths, function names
- No tools (reason from plan text only)
- No vague concerns ("this might have issues" = rejected)

## When Deliberation Runs
- DIRECT: entirely skipped
- PLAN/BRAINSTORM: full (1-2 rounds on plan only)
- FULL: full + wiring review
