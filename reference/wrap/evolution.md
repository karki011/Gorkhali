# Evolution Check & Archive/Shutdown

> **Context:** Called during `/phantom:wrap` after ship ceremony completes. Final phase — archives session state, syncs memory, audits compliance, and shuts down shadows.

## Evolution Check (Haiku sidecar)

Spawn Haiku agent (model: haiku, mode: bypassPermissions, run_in_background: false):

Prompt: "Scan learnings/INDEX.md. Find:
1. Entries with [validated:5+] -> Tier 1 (auto-promote to reference/)
2. [failed] corrections in 3+ sessions -> Tier 2 (propose skill edit)
3. Repeated multi-step patterns in 4+ sessions -> Tier 3 (propose new skill)
4. Files over size cap? (reference: 100 lines, commands: 80 lines)
Output JSON: {tier1: [...], tier2: [...], tier3: [...], oversized: [...]}"

Process results (see `reference/evolution.md` for full protocol):
- Tier 1: auto-apply, prune INDEX entry, log to `state/evolution-log.json`
- Tier 2-3: present to user, apply on approval, log
- Oversized: offer Haiku distillation

## Archive Session

- Copy session state to `state/completed/{TICKET}/`
- Update `state/current.json`: remove {TICKET} from active sessions

## Memory Layer Sync

Persist key learnings to Claude auto-memory. After Trigger 3 validates patterns, sync significant learnings to Claude's persistent memory.

### What to sync (only high-value, cross-session patterns):
- Corrections from this session (Trigger 0 or Trigger 2 entries)
- Patterns promoted to `[validated:5+]` this session
- Decisions recorded in `sessions/{TICKET}/decisions.md` marked as cross-cutting
- NOT: session-specific context, temporary state, or task details

### Where to sync:
Write to `~/.claude/projects/{PROJECT_PATH}/memory/` as memory files:
```
File: learning_{REPO_NAME}_{keyword}.md
---
name: {keyword} learning
description: {one-line description of the pattern/correction}
type: feedback
---

{Pattern or correction content}
**Why:** {context from the session}
**How to apply:** {when this pattern is relevant}
```

Update the project's `MEMORY.md` index with a one-liner pointer.

### Dedup check:
Before writing, scan existing memory files for the same keyword.
If exists -> update the existing file instead of creating a duplicate.

### Why this matters:
Claude's auto-memory loads at session start regardless of whether the Phantom is invoked. Critical corrections and validated patterns survive even in quick sessions that don't load the full Phantom.

## Post-Archive Steps

1. Update auto-memory (`project_*.md` in memory dir)

2. **Core Discipline #13 audit report** — scan `${PHANTOM_DATA:-~/.claude/phantom-data}/audit/apex-edits-$(date +%Y-%m-%d).jsonl` for this session:
   ```bash
   grep "\"session\":\"{SESSION_ID}\"" ${PHANTOM_DATA:-~/.claude/phantom-data}/audit/apex-edits-*.jsonl 2>/dev/null
   ```
   - If no entries -> Core Discipline #13 held (subagent-driven was respected)
   - If entries found -> violations occurred. Report in wrap summary:
     - Count of violations
     - Files touched directly
     - Append summary to `learnings/shadows.md ## Corrections`: `CORRECTION [subagent-driven]: Apex edited {N} files directly — should have spawned Blade [failed] ({date})`
   - This is informational for Option C mode. If Option A (hard block) was active, violations wouldn't have been possible.

3. **Deactivate apex hook ward:**
   ```
   rm -f ${PHANTOM_DATA:-~/.claude/phantom-data}/.apex-active
   rm -f ${PHANTOM_DATA:-~/.claude/phantom-data}/.blade-editing
   ```

4. **Clear native `/goal` if still active:**
   ```
   /goal clear
   ```
   Safe to run even if no goal is active — it's a no-op. Prevents a lingering goal from auto-triggering turns after wrap.

5. Shut down shadows
