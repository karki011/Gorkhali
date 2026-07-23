---
name: pause
description: "Use when stepping away, going to a meeting, or saving progress mid-session. Also use when user says 'pause', 'I gotta jump to a meeting', 'save where we are', 'checkpoint', 'done for today', 'I'll come back', 'context switch', or 'save state'. No git ops — just saves artifacts. Use phantom:wrap to ship."
---

> **Preamble Tier: T4** — loads all shared contexts through the canonical tier registry

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

3. **Write portable handoff packet** to `{SESSION_DIR}/handoff.md` AND print its full contents inline (so it can be pasted into a fresh session, another agent like Codex/Cursor, or Slack). Self-contained: inline the state, don't just reference local paths — the reader may not have them. Source from existing artifacts (`intent.json`, `plan.json`, `decisions.json`/`decisions.md`, contracts, the `pause-state.json` just written) + git state. No new user input. Any artifact missing → omit that section or write `n/a`; never block the pause.

<output_format>
   ```markdown
   # Handoff: {TICKET} — {one-line goal}

   _Generated {ISO 8601 now} · branch `{branch}` · HEAD `{short sha}` · PR {#number or "none"}_

   ## Goal
   {what we're trying to achieve}

   ## Status
   Phase {A/B/C/D} · route {solo|shadows} · {N done / M pending} · verify {pass|fail|n/a}

   ## Done
   - {completed work}

   ## Next
   1. {immediate actionable step}
   2. {…}

   ## Key decisions & constraints
   - {from decisions.json/intent.json; n/a if none}

   ## Files touched
   - `{path}` — {what changed}

   ## How to verify
   ```bash
   {TEST_CMD}
   {LINT_CMD}
   {BUILD_CMD}
   ```

   ## Gotchas / learnings
   - {from learnings written this session; n/a if none}

   ## To continue
   - **Same machine:** `/phantom:resume {TICKET}`
   - **Fresh session / another agent:** paste this entire packet as your first message.
   ```
</output_format>

4. **Write session log** to `{TEAM_DIR}/sessions/{TICKET}/{date}_{slug}.md`
   - Summary of work done
   - Key decisions made
   - Resume instructions

5. **Append learnings** to relevant domain files in `learnings/`

6. **Update INDEX.md** with new entries

7. **Update auto-memory** in project memory directory

8. **Close cost interval + report**:
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

Print: "Session paused. Handoff packet written to `{SESSION_DIR}/handoff.md` and printed above — copy-paste it to continue in a fresh session or another agent. Same machine: run `/clear` then `/phantom:resume {TICKET}`."
