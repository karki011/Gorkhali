---
name: learn
description: "Use when you discover something worth remembering — record a correction, save a pattern, note a gotcha ('remember this', 'don't do that again'). Captures learnings to the domain knowledge files."
argument-hint: "<correction>"
# User-invocable (default) - typed /gorkhali:learn resolves here. The same-named skill (skills/learn/SKILL.md) carries user-invocable: false to stay off the / menu; this command remains the canonical procedure and the single menu surface. Do not flip without re-checking menu duplication.
---

> **Preamble Tier: T1** — loads `_shared.md` only (canonical registry: `scripts/preamble-tier.js`)

# /gorkhali:learn "$ARGUMENTS"

Categorize the learning and route to the correct domain file:

1. **Identify the domain**: ui, data, auth, testing, shadows, migration, or tooling
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

If the target learnings file is already >80 lines after appending, run (`{PR_BOOTSTRAP}` per `_shared.md` §Paths):
```bash
{PR_BOOTSTRAP}
SCRIPTS="$PR/scripts"
if [ -n "$PR" ] && command -v python3 >/dev/null 2>&1 && [ -d "$SCRIPTS/compress" ]; then
  (cd "$SCRIPTS" && python3 -m compress <absolute_path>) || echo "Skipping caveman compress: compression unavailable."
else
  echo "Skipping caveman compress: python3 or scripts/compress not available."
fi
```
