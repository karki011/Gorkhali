---
name: resume
description: "Use when continuing PREVIOUS work from a paused or prior session — 'resume', 'pick up where we left off'. Restores context and plan. New scope → gorkhali:start; approved plan → gorkhali:execute."
# Hidden from the Claude Code / menu to deduplicate entries — the same-named skill is the single menu surface and delegates to this command, which remains the canonical procedure. Do not flip without re-checking menu duplication.
user-invocable: false
---

> **Preamble Tier: T4** — loads ALL shared contexts (canonical registry: `scripts/preamble-tier.js`)

# /gorkhali:resume "$ARGUMENTS"

Resume from a paused session by reading the state artifact.

<instructions>
1. **Detect ticket** from `$ARGUMENTS` (required — e.g., `/gorkhali:resume PROJ-123`; accept any `[A-Z][A-Z0-9]+-\d+` key as-is, no project-prefix validation)

2. **Read state artifact**: `{TEAM_DIR}/sessions/{TICKET}/pause-state.json`
   - If missing: list available sessions in `{TEAM_DIR}/sessions/`, ask user to pick
   - If found: load and display summary
   - Note: `pause-state.json` is same-machine resume state (what this command reads). Its sibling `handoff.md` is a portable, self-contained packet for cold/cross-context continuation (a fresh session or another agent) — not needed here.

<staleness_check>
3. **Staleness check**: Compare `_meta.gitHead` to current `git rev-parse --short HEAD`
   - Match → continue
   - Mismatch → warn: "State saved at {old HEAD} but HEAD is now {new HEAD}."
     Show: `git log {old}..{new} --oneline`
     Ask: "Continue from saved state or start fresh?"
</staleness_check>

3.5. **Link session to cost ledger** (silent, never blocks; `{PR_BOOTSTRAP}` per `_shared.md` §Paths):
   `{PR_BOOTSTRAP}; [ -n "$PR" ] && node "$PR/scripts/cost-link.js" open {TICKET}`

   Checkpoint: `PR="${PR:-$(ls -dt "$HOME"/.claude/plugins/cache/gorkhali/gorkhali/*/ 2>/dev/null | head -1)}"; PR="${PR%/}"; if [ -n "$PR" ]; then printf '%s\n' '{"ticket":"{TICKET}"}' | node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints resume-restore || :; fi` (advisory - semantics: `_shared.md` §Checkpoints). If `{SESSION_DIR}/checkpoints/` exists, read latest via `latest` sub-command first; MISSING or empty checkpoints → fall back to existing artifact discovery, never error.

4. **Restore context** from artifact paths:
   - Read `intent.json` (from `intent` field)
   - Read `plan.json` (from `plan` field)
   - Read active contracts (from `contracts` field)
   - Load `decisions/global.md`
   - Load `learnings/INDEX.md` + domain files matching task type

5. **Display resume summary**:
   ```
   RESUMING: {TICKET}
   Phase:    {phase} (step: {phaseStep})
   Route:    {route}
   Done:     {contractsCompleted}
   Pending:  {contractsPending}
   Notes:    {resumeNotes}
   ```

6. **Continue from last phase**:
   - Phase B → re-enter planning (plan.json loaded)
   - Phase C → create remaining contracts
   - Phase D → dispatch pending tasks
   - Verify → re-run verification

7. **PR watch tick** (no prompt): if `{SESSION_DIR}/pr-watch.json` exists, `status`
   is `watching`, and the PR is still open, run **one** watch tick per
   `reference/pr-watch.md` (`CHIEF_PING` / `CHIEF_ACK`; spawn
   `subagent_type: "clerk"`, `name: "clerk-herald"`). Do not ask the user.
   Skip if status is `paused`/`stopped` or the PR is merged/closed.
</instructions>
