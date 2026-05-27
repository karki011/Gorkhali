---
name: phantom:evolve
description: "Use when learnings files are getting large, patterns should be promoted to global, or the knowledge system needs maintenance. Scans learnings, proposes promotions to global patterns, distills oversized files, and cleans stale entries. Also use when user says 'clean up learnings', 'promote patterns', 'knowledge maintenance', or 'evolve the system'."
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /phantom:evolve

Run the 3-tier evolution pipeline on the learnings system.

## Steps

1. **Invoke the runner:**
   ```bash
   node ~/.claude/team/scripts/evolution-runner.js
   ```
   For preview without changes:
   ```bash
   node ~/.claude/team/scripts/evolution-runner.js --dry-run
   ```

2. **Review output** — the runner prints:
   - Tier 1: Stale entries (30+ days) and removable entries (60+ days)
   - Tier 2: Patterns promoted to `global/patterns/` (those with `[validated:5+]`)
   - Tier 3: Domains exceeding 50-entry cap (need manual distillation)

3. **Handle Tier 3 (if any):** For oversized domains, manually distill:
   - Merge entries that say the same thing differently
   - Remove entries absorbed into reference/ or skill files
   - Sharpen: strip session-specific context, keep the rule
   - Preserve `[validated:N]` counts (merge = sum counts)
   - Never delete `[failed]` entries unless explicitly overridden

4. **Verify log:** Check `state/evolution-log.json` for the new entry.

## Flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview changes without writing any files |

## When to Run

- After 5+ sessions (routine maintenance)
- When `learnings/INDEX.md` feels bloated
- Before archiving a milestone
- At `/phantom:wrap` time (evolution check in wrap protocol)
