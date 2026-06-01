---
name: phantom:evolve
description: "Use when learnings files are getting large, patterns should be promoted to global, or the knowledge system needs maintenance. Scans learnings, proposes promotions to global patterns, distills oversized files, and cleans stale entries. Also use when user says 'clean up learnings', 'promote patterns', 'knowledge maintenance', or 'evolve the system'."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /phantom:evolve

Run the 3-tier evolution pipeline on the learnings system via a Ward sidecar agent.

<evolution_coordination>

## Coordinator Role (Main LLM)

You orchestrate the evolution. You do NOT run the evolution-runner.js script directly.

### Step 1: Assess Need

Check if evolution is warranted:
- Read `learnings/INDEX.md` — count entries, check for staleness signals
- Check `{TEAM_DIR}/evolution-log.json` for last evolution date
- If recent (< 3 sessions ago) and no bloat, inform user and skip

### Step 2: Spawn Ward Sidecar

Spawn a **Ward** agent to handle Tier 1 and Tier 2 processing:

- subagent_type: `ward` (model + effort come from the agent definition)
- mode: `bypassPermissions`

**Ward prompt must include:**
- Script path: `${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/phantom}/scripts/evolution-runner.js`
- Flag: `--dry-run` if user requested preview, otherwise no flag
- Instructions to run the script and capture full output
- Instructions to return structured report:
  ```
  {
    tier1: { staleCount: number, removedCount: number, entries: string[] },
    tier2: { promotedCount: number, patterns: string[] },
    tier3: { oversizedDomains: { domain: string, entryCount: number }[] }
  }
  ```
- Instructions to verify `{TEAM_DIR}/evolution-log.json` was updated (non-dry-run only)

### Step 3: Process Results

After Ward returns:
- Present Tier 1 and Tier 2 results as summary
- If Tier 3 domains exist, handle them in main context (requires judgment):
  - Merge entries that say the same thing differently
  - Remove entries absorbed into reference/ or skill files
  - Sharpen: strip session-specific context, keep the rule
  - Preserve `[validated:N]` counts (merge = sum counts)
  - Never delete `[failed]` entries unless explicitly overridden
- Confirm evolution-log.json entry

</evolution_coordination>

## Flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview changes without writing any files |

## When to Run

- After 5+ sessions (routine maintenance)
- When `learnings/INDEX.md` feels bloated
- Before archiving a milestone
- At `/phantom:wrap` time (evolution check in wrap protocol)
