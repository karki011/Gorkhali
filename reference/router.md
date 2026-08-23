# Adaptive Cognitive Router

Author: Subash Karki

The router classifies tasks into the minimum-viable cognitive route.
Human intervention scales with **uncertainty**, not task size.

## Routes

| Route | Ceremony | Human Gates | When |
|-------|----------|-------------|------|
| **LITE** | Execute + Inspect | 0 | Trivial scope, <=2 files, known pattern, very high confidence |
| **DIRECT** | Execute + Verify | 0 | Clear scope, <=3 files, known pattern, confidence >=0.9 |
| **PLAN** | Decompose + Deliberate + Execute + Verify | 1 (approve plan) | Clear scope, 3-10 files, known approach, confidence >=0.7 |
| **BRAINSTORM** | Diverge + Converge + Plan + Deliberate + Execute + Verify | 2 (approve direction + approve plan) | Ambiguous scope, new domain, competing patterns, confidence <0.7 |
| **FULL** | Brainstorm + Plan + Wire + Execute + Verify | 3 (approve direction + approve plan + approve wiring) | 10+ files, 3+ packages, cross-layer, security/schema/public-API |

## Sub-documents

| File | Contents |
|------|----------|
| [router/signals.md](router/signals.md) | Signal dimensions, weights, extraction cost |
| [router/algorithm.md](router/algorithm.md) | Classification algorithm, scoring, route selection |
| [router/routes.md](router/routes.md) | LITE / DIRECT / PLAN / BRAINSTORM / FULL route specs |
| [router/deliberation.md](router/deliberation.md) | Planner-Challenger protocol, max rounds |
| [router/questions.md](router/questions.md) | Question-asking rules, banned patterns |

## Learning Integration

- Route selected + outcome (SUCCESS / ESCALATED / OVERKILL) recorded in `learnings/shadows.md` routing-history
- Route escalation (e.g., DIRECT->PLAN) creates correction bias for future classification
- Questions asked vs auto-resolved expand auto-resolve patterns
- Deliberation challenges that caught real issues tagged `[devil-advocate:validated]`

### Correction Feedback Loop
```
Session completes -> compare planned route vs actual execution
  Route held -> record SUCCESS
  Route escalated (DIRECT->PLAN) -> record ESCALATED, compute +bias
  Route was overkill (BRAINSTORM, no questions needed) -> record OVERKILL, compute -bias
Next similar task -> classifier applies correction bias
```
