---
name: grill
description: "Use when you want a Socratic challenge on your own changes — 'grill me', 'quiz me', 'test my understanding', 'play devil's advocate' — before shipping. NOT for code review (use gorkhali:review)."
argument-hint: "[--hard] [--quick]"
# Hidden from the Claude Code / menu to deduplicate entries — the same-named skill is the single menu surface and delegates to this command, which remains the canonical procedure. Do not flip without re-checking menu duplication.
user-invocable: false
---

> **Preamble Tier: T1** — loads `_shared.md` only (canonical registry: `scripts/preamble-tier.js`)

# /gorkhali:grill

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

**2+ SHAKY or any MISS:** `VERDICT: NOT YET` — list specific gaps, recommend investigate/add test/rethink. Run `/gorkhali:grill` again after addressing.

## Integration

Manual only - `/gorkhali:wrap` no longer auto-invokes grill. Run it yourself anytime, or pass `--grill` to `/gorkhali:wrap` to run it in addition to the always-on Defense Brief (see `reference/wrap/defense-brief.md`), never instead of it. Verdict recorded in the session board (`{TEAM_DIR}/sessions/{TICKET}.json`).

## Rules

- Never give away answers during questioning
- "I don't know" = most valuable answer. Flag as MISS, move on.
- Respectful but firm. Don't softball.
- Focus on the DIFF only, not the entire codebase.
