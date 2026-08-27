# Evolution Check & Archive/Shutdown

> **Context:** User-invoked via `/gorkhali:evolve`, not wrap. Wrap is ship-only. Automatic capture of failed commands is the Stop hook.

## Evolution Check (Inspector sidecar, haiku-pinned)

Spawn the Inspector sidecar (`subagent_type: "inspector"`, `name: "inspector-zelmar"`, `mode: bypassPermissions`, `run_in_background: false`; inspector pins `haiku` in its agent definition — the economy rung, generated from model-policy.json):

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
Claude's auto-memory loads at session start regardless of whether the Gorkhali is invoked. Critical corrections and validated patterns survive even in quick sessions that don't load the full Gorkhali.

## Post-Archive Steps

1. Update auto-memory (`project_*.md` in memory dir)

2. **Core Discipline #13 audit report** — scan `${GORKHALI_DATA:-~/.gorkhali}/audit/chief-edits-$(date +%Y-%m-%d).jsonl` for this session:
   ```bash
   grep "\"session\":\"{SESSION_ID}\"" "${GORKHALI_DATA:-$HOME/.gorkhali}"/audit/chief-edits-*.jsonl 2>/dev/null
   ```
   - If no entries -> Core Discipline #13 held (subagent-driven was respected)
   - If entries found -> violations occurred. Report in wrap summary:
     - Count of violations
     - Files touched directly
     - Append summary to `learnings/shadows.md ## Corrections`: `CORRECTION [subagent-driven]: Chief edited {N} files directly — should have spawned Engineer [failed] ({date})`
   - This is informational for Option C mode. If Option A (hard block) was active, violations wouldn't have been possible.

3. **Deactivate chief hook inspector:**
   ```
   rm -f "${GORKHALI_DATA:-$HOME/.gorkhali}/.chief-active"
   rm -f "${GORKHALI_DATA:-$HOME/.gorkhali}/.engineer-editing"
   ```

4. **Clear native `/goal` if still active:**
   ```
   /goal clear
   ```
   Safe to run even if no goal is active — it's a no-op. Prevents a lingering goal from auto-triggering turns after wrap.

5. Shut down shadows
