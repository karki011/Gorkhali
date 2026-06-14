---
name: phantom:pause
description: "Use when stepping away, going to a meeting, or saving progress mid-session. Also use when user says 'pause', 'I gotta jump to a meeting', 'save where we are', 'checkpoint', 'done for today', 'I'll come back', 'context switch', or 'save state'. No git ops — just saves artifacts. Use phantom:wrap to ship."
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /phantom:pause

Save full session state so `/clear` + `/phantom:resume` restores everything.

<instructions>
1. **Capture git state**
   - Branch: `git branch --show-current`
   - HEAD: `git rev-parse --short HEAD`
   - Uncommitted: `git diff --name-only`

2. **Write state artifact** to `{TEAM_DIR}/sessions/{TICKET}/pause-state.json`:

<output_format>
   ```json
   {
     "_meta": {
       "writtenAt": "{ISO 8601 now}",
       "gitHead": "{HEAD sha}",
       "gitBranch": "{branch}",
       "phase": "{current phase A/B/C/D}",
       "skill": "phantom:pause",
       "version": 1
     },
     "ticket": "{TICKET}",
     "phase": "{A/B/C/D}",
     "phaseStep": "{specific step if known}",
     "status": "paused",
     "intent": "{TEAM_DIR}/sessions/{TICKET}/intent.json",
     "plan": "{TEAM_DIR}/sessions/{TICKET}/plan.json",
     "contracts": ["{list of contract file paths}"],
     "contractsCompleted": ["{completed task IDs}"],
     "contractsPending": ["{pending task IDs}"],
     "route": "{solo|shadows}",
     "verifyStatus": "{pass|fail|null}",
     "resumeNotes": "{what was being worked on, what's next}"
   }
   ```
</output_format>

3. **Write session log** to `{TEAM_DIR}/sessions/{TICKET}/{date}_{slug}.md`
   - Summary of work done
   - Key decisions made
   - Resume instructions

4. **Append learnings** to relevant domain files in `learnings/`

5. **Update INDEX.md** with new entries

6. **Update auto-memory** in project memory directory

7. **Close cost interval + report**:
   ```bash
   PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"
   [ -n "$PR" ] && node "$PR/scripts/cost-link.js" close {TICKET}
   [ -n "$PR" ] && node "$PR/scripts/cost-report.js" {TICKET}
   ```
   Include the report's `Total:` line in the pause summary. Never block the pause if it fails. Empty `$PR` (no plugin cache) → the `[ -n "$PR" ]` guards skip both silently; the pause still completes.

**Running workflow + pause.** A Claude Code dynamic workflow does NOT survive exiting Claude Code —
it restarts fresh next session (per docs), and `phantom:resume` cannot restore an in-flight run.
Before a cross-session pause, finish or stop the workflow (`/workflows` → `x`) and capture its
report into session artifacts.
</instructions>

Print: "Session paused. Run `/clear` then `/phantom:resume {TICKET}` to continue."
