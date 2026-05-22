---
name: team:pause
description: "Use when stepping away, switching context, taking a break, or saving progress. Saves session state, learnings, and resume notes."
---

> **Preamble Tier: T1** — loads `_shared.md` only

# /team:pause

Save full session state so `/clear` + `/team:resume` restores everything.

<instructions>
1. **Capture git state**
   - Branch: `git branch --show-current`
   - HEAD: `git rev-parse --short HEAD`
   - Uncommitted: `git diff --name-only`

2. **Write state artifact** to `state/sessions/{TICKET}/pause-state.json`:

<output_format>
   ```json
   {
     "_meta": {
       "writtenAt": "{ISO 8601 now}",
       "gitHead": "{HEAD sha}",
       "gitBranch": "{branch}",
       "phase": "{current phase A/B/C/D}",
       "skill": "team:pause",
       "version": 1
     },
     "ticket": "{TICKET}",
     "phase": "{A/B/C/D}",
     "phaseStep": "{specific step if known}",
     "status": "paused",
     "intent": "state/sessions/{TICKET}/intent.json",
     "plan": "state/sessions/{TICKET}/plan.json",
     "contracts": ["{list of contract file paths}"],
     "contractsCompleted": ["{completed task IDs}"],
     "contractsPending": ["{pending task IDs}"],
     "route": "{solo|crew}",
     "verifyStatus": "{pass|fail|null}",
     "resumeNotes": "{what was being worked on, what's next}"
   }
   ```
</output_format>

3. **Write session log** to `sessions/{TICKET}/{date}_{slug}.md`
   - Summary of work done
   - Key decisions made
   - Resume instructions

4. **Append learnings** to relevant domain files in `learnings/`

5. **Update INDEX.md** with new entries

6. **Update auto-memory** in project memory directory
</instructions>

Print: "Session paused. Run `/clear` then `/team:resume {TICKET}` to continue."
