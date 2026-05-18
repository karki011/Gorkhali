---
name: team:learn
description: Capture a learning mid-session
argument-hint: "<correction>"
---

> **Preamble Tier: T1** — loads '_shared.md' only

# /team:learn "$ARGUMENTS"

Categorize the learning and route to the correct domain file:

1. **Identify the domain**: ui, data, auth, testing, crew, migration, or tooling
2. **Identify the type**: Pattern, Correction, or Habit
3. **Assign lifecycle tag**:
   - Pattern → `[proposed]` (new, untested) or `[validated:1]` (if captured from a successful session outcome)
   - Correction → `[failed]` (always — corrections document what didn't work)
   - Habit → `[validated:1]` (habits are already confirmed behaviors)
4. **Format corrections with approach signature**:
   `CORRECTION [{approach-keyword}]: [{what went wrong}] — [{what to do instead}] [failed] ({date})`
5. **Append** to the matching section in `learnings/{domain}.md`:
   - Pattern → under `## Patterns`
   - Correction → under `## Corrections`
   - Habit → under `## Habits`
6. **Update `learnings/INDEX.md`** quick reference with a one-liner including lifecycle tag

**Other routing (unchanged):**
- **Decision (feature-specific)** -> add to `sessions/{TICKET}/decisions.md`
- **Decision (cross-cutting)** -> add to `decisions/global.md`
- **Agent-specific** -> append to agent file's Learnings section

**If no domain fits**, create a new `learnings/{domain}.md` with `## Patterns`, `## Corrections`, `## Habits` sections.

**Write in caveman-compressed format** — drop articles/filler/hedging, use fragments, short synonyms. Technical terms exact. Example:
- Not: "You should always make sure to use semantic tokens instead of hardcoded hex values"
- Yes: "Use semantic tokens, never hardcoded hex"

If the target learnings file is already >80 lines after appending, run:
```bash
cd ~/.claude/plugins/marketplaces/caveman/compress && python3 -m scripts <absolute_path>
```
