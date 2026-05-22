# Planning Protocol

## Intent Capture (mandatory)

```
Goal:            [success in one sentence]
Done When:       [machine-checkable exit conditions — verifiable predicates]
Priority:        [speed | quality | ux | stability | scope — ranked]
Tradeoffs:       [what CAN be sacrificed]
Non-negotiables: [what MUST NOT be compromised]
```

Done When sourcing:
1. Jira acceptance criteria (if available) → default
2. Ask user explicitly → required if no Jira
3. Format as verifiable predicates ("tests pass", "lint clean", "endpoint returns 200")

## Devil's Advocate (mandatory, every plan)

Spawn oracle agent (opus, no tools, blocking):
- Input: complete plan + coding principles
- Output: Challenges (must address), Warnings (consider), Verdict
- PROCEED → continue. REVISE → address + re-run. RETHINK → back to research.
- Max 2 iterations. Still RETHINK → escalate to user.

## Codebase Research

Spawn Explore (opus) + Plan (opus) agents for:
- File structure and patterns
- Existing similar implementations
- Import/dependency chains

## Anti-Repetition Check

Before finalizing plan:
1. Scan `learnings/INDEX.md` for matching corrections
2. `[failed]` entries → acknowledge, explain difference, or choose alternative
3. Log matches in plan under anti-repetition notes

## SOLO vs CREW Decision

See `reference/agents.md` for routing table.
