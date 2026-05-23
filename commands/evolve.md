---
name: team:evolve
description: "Use when learnings files are getting large, patterns should be promoted to global, or the knowledge system needs maintenance. Scans learnings, proposes promotions to global patterns, distills oversized files, and cleans stale entries. Also use when user says 'clean up learnings', 'promote patterns', 'knowledge maintenance', or 'evolve the system'."
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /team:evolve

Run the evolution pipeline manually (normally runs at wrap time).

1. READ `reference/evolution.md` for protocol
2. Spawn Haiku agent to scan `learnings/INDEX.md`:
   - `[validated:5+]` → Tier 1 candidates
   - `[failed]` corrections ×3+ → Tier 2 candidates
   - Repeated patterns → Tier 3 candidates
3. Present candidates to user
4. On approval: apply changes, log to `state/evolution-log.json`
5. Check file size caps (reference: 100, commands: 80, INDEX: 80 entries, domain: 50)
6. If oversized: offer distillation via Haiku

Also: staleness check — learnings entries 30+ days old → mark `[stale]`.
