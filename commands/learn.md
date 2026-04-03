---
name: team:learn
description: Capture a learning mid-session
argument-hint: "<correction>"
---

> Load `_shared.md` (core only -- no additional tiers needed).

# /team:learn "$ARGUMENTS"

Categorize the learning and route to the correct domain file:

1. **Identify the domain**: ui, data, auth, testing, crew, migration, or tooling
2. **Identify the type**: Pattern, Correction, or Habit
3. **Append** to the matching section in `learnings/{domain}.md`:
   - Pattern → under `## Patterns`
   - Correction → under `## Corrections`
   - Habit → under `## Habits`
4. **Update `learnings/INDEX.md`** quick reference with a one-liner

**Other routing (unchanged):**
- **Decision (feature-specific)** -> add to `sessions/{TICKET}/decisions.md`
- **Decision (cross-cutting)** -> add to `decisions/global.md`
- **Agent-specific** -> append to agent file's Learnings section

**If no domain fits**, create a new `learnings/{domain}.md` with `## Patterns`, `## Corrections`, `## Habits` sections.
