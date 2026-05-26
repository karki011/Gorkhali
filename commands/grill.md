---
name: team:grill
description: "Use when you want a Socratic challenge on your own changes — test your understanding, stress-test your reasoning, or quiz yourself before shipping. Also use when user says 'grill me', 'quiz me', 'test my understanding', 'challenge me on this', or 'play devil's advocate'. NOT for code review — use team:review."
argument-hint: "[--hard] [--quick]"
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /team:grill

Role reversal: Claude becomes the interviewer. You prove you understand your own code.

## Why This Exists

- Tests passing ≠ understanding
- AI-written code ships under YOUR name
- Edge cases hide in code you didn't write yourself
- Traditional review checks the code — grill checks the human

## Process

### 1. Gather the Diff

```bash
# Get all changes vs base branch
git diff main...HEAD
# If no diff, try develop
git diff develop...HEAD
```

Also run: `git log main..HEAD --oneline` to see commit history.

### 2. Analyze Silently

Read the diff. Identify:
- **Edge cases** not covered by tests
- **Failure modes** (network errors, null states, race conditions, empty arrays)
- **Design decisions** that have alternatives
- **Implicit assumptions** (env vars, config, dependency versions)
- **Security surface** (input validation, auth checks, data exposure)
- **Rollback risk** (migrations, schema changes, feature flags)

Do NOT share this analysis with the user. Keep it as your interview prep.

### 3. Grill Session

Ask questions **one at a time**. Wait for the user's answer before asking the next.

**Question format:** Direct, specific, tied to actual code lines. Not vague.
- BAD: "How do you handle errors?"
- GOOD: "Line 47 catches the API error but returns an empty array. What happens to the loading state in the parent component?"

**Difficulty modes:**
- `--quick`: 3 questions, focus on highest-risk areas only
- Default: 5 questions, balanced coverage
- `--hard`: 7 questions, adversarial — tries to find something you missed

**Question categories (pick from all, don't use all every time):**
1. **Edge case probe**: "What happens when [specific input] hits [specific line]?"
2. **Failure mode**: "If [dependency] is down/slow/returns garbage, what does the user see?"
3. **Design defense**: "Why [this approach] instead of [obvious alternative]?"
4. **Blast radius**: "What existing functionality could this break?"
5. **Rollback plan**: "If this causes a production incident, how do you revert?"
6. **Data integrity**: "What happens to existing data when this deploys?"
7. **Security check**: "Could a malicious user exploit [specific path]?"

### 4. Evaluate Answers

For each answer, assess:
- **SOLID**: User demonstrates clear understanding with specifics
- **SHAKY**: User gives a plausible answer but can't point to the code that handles it
- **MISS**: User didn't know about this case

Don't accept hand-waving. If the answer is vague, follow up: "Show me which line handles that."

### 5. Verdict

After all questions:

**If all SOLID or mostly SOLID with 1 SHAKY:**
```
  VERDICT: SHIP IT
  
  You understand your changes. Proceed to PR.
  
  Confidence: {high|medium}
  Gaps noted: {any SHAKY areas — not blocking but worth a comment}
```

**If 2+ SHAKY or any MISS:**
```
  VERDICT: NOT YET
  
  Gaps found:
  - {specific gap 1 — what you didn't know}
  - {specific gap 2}
  
  Recommendation: {investigate/add test/add comment/rethink}
  
  Run /team:grill again after addressing these.
```

## Integration with Team Workflow

This command is called automatically by `/team:wrap` BEFORE PR creation when the session had significant AI-generated code (3+ files changed by agents).

It can also be called manually at any time: `/team:grill` or `/team:grill --hard`.

The grill verdict is logged to the session event log for audit.

## Rules

- Never give away the answers during questioning. The point is to test, not teach.
- If the user says "I don't know" — that's the most valuable answer. Flag it as a MISS and move on.
- Be respectful but firm. Don't softball questions because the user seems frustrated.
- Focus on the DIFF, not the entire codebase. Only grill on what changed.
