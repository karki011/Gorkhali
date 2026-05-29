---
name: phantom:grill
description: "Use when you want a Socratic challenge on your own changes — test your understanding, stress-test your reasoning, or quiz yourself before shipping. Also use when user says 'grill me', 'quiz me', 'test my understanding', 'challenge me on this', or 'play devil's advocate'. NOT for code review — use phantom:review."
argument-hint: "[--hard] [--quick]"
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /phantom:grill

Role reversal: Claude becomes the interviewer. You prove you understand your own code.

## Process

### 1. Gather the Diff

```bash
git diff main...HEAD  # or develop if no diff
git log main..HEAD --oneline
```

### 2. Analyze Silently

Read the diff. Identify edge cases, failure modes, design alternatives, implicit assumptions, security surface, rollback risk. Do NOT share this analysis — it's your interview prep.

### 3. Grill Session

Ask questions **one at a time**. Wait for the user's answer before the next.

**Format:** Direct, specific, tied to actual code lines.
- BAD: "How do you handle errors?"
- GOOD: "Line 47 catches the API error but returns an empty array. What happens to the loading state in the parent component?"

**Difficulty:** `--quick` = 3 questions (highest-risk only) | default = 5 | `--hard` = 7 (adversarial)

**Categories** (pick from, don't use all):
1. Edge case probe — "What happens when [input] hits [line]?"
2. Failure mode — "If [dependency] is down, what does the user see?"
3. Design defense — "Why [this] instead of [alternative]?"
4. Blast radius — "What existing functionality could this break?"
5. Rollback plan — "How do you revert if this causes an incident?"
6. Data integrity — "What happens to existing data on deploy?"
7. Security check — "Could a malicious user exploit [path]?"

### 4. Evaluate Answers

- **SOLID**: Clear understanding with specifics
- **SHAKY**: Plausible but can't point to the code
- **MISS**: Didn't know about this case

Don't accept hand-waving. Follow up: "Show me which line handles that."

### 5. Verdict

**All SOLID / mostly SOLID + 1 SHAKY:** `VERDICT: SHIP IT` — confidence high/medium, note any SHAKY gaps.

**2+ SHAKY or any MISS:** `VERDICT: NOT YET` — list specific gaps, recommend investigate/add test/rethink. Run `/phantom:grill` again after addressing.

## Integration

Auto-called by `/phantom:wrap` before PR when 3+ files changed by agents. Can also run manually. Verdict logged to session event log.

## Rules

- Never give away answers during questioning
- "I don't know" = most valuable answer. Flag as MISS, move on.
- Respectful but firm. Don't softball.
- Focus on the DIFF only, not the entire codebase.
