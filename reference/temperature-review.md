# Temperature-Based Code Review

## Temperature Scale

| Temp | Qualifies | Action |
|------|-----------|--------|
| **P0** (critical) | Runtime crash, security vulnerability, data loss, broken API contract, null pointer on common path | Auto-fix, block ship |
| **P1** (high) | Logic error, missing edge case, wrong behavior user would notice, broken test, incorrect return value | Auto-fix, block ship |
| **P2** (medium) | Style, naming, minor refactor, small cleanup, comment quality | Drop — do not fix, do not report |
| **P3** (low) | Suggestion, nice-to-have, personal preference, "consider doing X" | Drop — do not report |

## Review Agent Prompt

Use this prompt when spawning the temperature review agent:

    Review this diff against the intent. Score each finding by temperature:

    P0 (critical): Breaks functionality, security vulnerability, data loss,
                   runtime crash. MUST fix before shipping.
    P1 (high):     Logic error, missing edge case, wrong behavior the user
                   would notice. SHOULD fix before shipping.
    P2 (medium):   Style, naming, minor refactor. DO NOT REPORT.
    P3 (low):      Suggestion, preference. DO NOT REPORT.

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

## Auto-Address Loop

1. If findings[] is empty → verdict: pass. Write verification.json.
2. If P0/P1 findings exist → spawn 1 fix agent with scoped findings
3. After fix → re-run correctness commands (lint, build, tests)
4. Re-review ONLY the fix diff (not the whole codebase)
5. Max 2 loops. Still P0/P1 after 2 → escalate to user
6. Same finding class twice → escalate (don't loop on the same bug)

## What Users See

Nothing during review. The review-address loop is invisible. Users see:
- Clean diff + PR if no issues found
- Escalation ONLY if P0/P1 persists after 2 fix loops

P2 findings (if any were noted internally) go in a collapsed details section in the PR body — not action items.
