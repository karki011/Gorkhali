# Temperature-Based Code Review

## Temperature Scale

| Temp | Qualifies | Action |
|------|-----------|--------|
| **P0** (critical) | Runtime crash, security vulnerability, data loss, broken API contract, null pointer on common path | Auto-fix, block ship |
| **P1** (high) | Logic error, missing edge case, wrong behavior user would notice, broken test, incorrect return value | Auto-fix, block ship |
| **P2** (medium) | Style, naming, minor refactor, small cleanup, comment quality | Drop — do not fix, do not report |
| **P3** (low) | Suggestion, nice-to-have, personal preference, "consider doing X" | Drop — do not report |

## Review Agent Prompt

Use this prompt when spawning the power level agent:

    Review this diff against the intent. Score each finding by temperature:

    P0 (critical): Breaks functionality, security vulnerability, data loss,
                   runtime crash. MUST fix before shipping.
    P1 (high):     Logic error, missing edge case, wrong behavior the user
                   would notice. SHOULD fix before shipping.
    P2 (medium):   Style, naming, minor refactor. DO NOT REPORT.
    P3 (low):      Suggestion, preference. DO NOT REPORT.

    STATE MATRIX CHECK (mandatory for UI components):
    If the diff adds or modifies a component that reacts to enumerated
    states (sidebar: open/collapsed/pill, drawer: open/closed/expanded,
    panel: open/closed, etc.):
    1. List every enumerated state the component reacts to (switch/if)
    2. For each state, verify positioning doesn't collide with other
       fixed/absolute elements at those coordinates
    3. Flag as P1 any state where a new element occludes an existing
       interactive element (button, link, toggle)
    4. Flag as P1 any state where content margin/padding math doesn't
       account for the new element's width
    This is NOT optional. Missing state coverage is a P1 finding.

    Output ONLY P0 and P1 findings as JSON array:
    [
      {
        "temperature": "P0",
        "file": "src/Example.tsx",
        "line": 42,
        "issue": "Null check missing — crashes when data is undefined",
        "fix": "Add optional chaining: data?.items"
      }
    ]

    Empty array [] = clean code = SHIP IT.
    Do NOT invent findings to justify your existence.

## Fix-Loop Ceiling (canonical)

**The fix-loop ceiling is 2.** This is the ONE constant for every verify/fix/re-review
loop across Phantom — verify.md, fix.md, apex.md, start.md, contracts.md, and
agents/reference all DEFER to this statement; none restates the number independently
(so it can't drift). Rationale: the user's CLAUDE.md rule — *"if a fix attempt fails
twice with the same error class, STOP patching; the approach is wrong."*

The count is OWNED by `hooks/loop-controller.js` (a deterministic counter), not by prose.
Prose describes the loop; the controller enforces the ceiling, the same-finding-class
escalation, and the explicit operator override. The `review.fixLoops` field in
`verification.json` is the same counter the controller reads/writes.

> **NOT this loop:** the VISUAL fix loop (`commands/visual.md`,
> `agents/reference/visual-protocol.md`) is a SEPARATE iteration loop with its own
> ceiling (3). Do not conflate the two — they count different things.

## Auto-Address Loop

1. If findings[] is empty → verdict: pass. Write verification.json.
2. If P0/P1 findings exist → spawn 1 fix agent with scoped findings
3. After fix → re-run correctness commands (lint, build, tests)
4. Re-review ONLY the fix diff (not the whole codebase)
5. Stop at the fix-loop ceiling (see above; enforced by `hooks/loop-controller.js`). Still P0/P1 → escalate to user
6. Same finding class twice → escalate (don't loop on the same bug)

## What Users See

Nothing during review. The review-address loop is invisible. Users see:
- Clean diff + PR if no issues found
- Escalation ONLY if P0/P1 persists past the fix-loop ceiling (see "Fix-Loop Ceiling")

P2 findings (if any were noted internally) go in a collapsed details section in the PR body — not action items.
