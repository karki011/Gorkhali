---
name: phantom:resume
description: "Use when continuing PREVIOUS work from a paused or prior session — restoring where you left off. Also use when user says 'resume', 'pick up where we left off', 'I'm back', 'continue from where we stopped', 'was in the middle of', 'stopped yesterday', or 'restore context'. NOT if adding new scope (use phantom:start) and NOT to run a fresh approved plan from this session (use phantom:execute). Restores full context and plan."
---

> **Preamble Tier: T1** — loads `_shared.md` only (artifacts provide the rest)

# /phantom:resume "$ARGUMENTS"

Resume from a paused session by reading the state artifact.

<instructions>
1. **Detect ticket** from `$ARGUMENTS` (required — e.g., `/phantom:resume PROJ-123`; accept any `[A-Z][A-Z0-9]+-\d+` key as-is, no project-prefix validation)

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

3.5. **Link session to cost ledger** (silent, never blocks; self-resolve {PLUGIN_ROOT} env-free: `PR="$(ls -dt "$HOME"/.claude/plugins/cache/phantom/phantom/*/ 2>/dev/null | head -1)"; PR="${PR%/}"`):
   `[ -n "$PR" ] && node "$PR/scripts/cost-link.js" open {TICKET}`

   Checkpoint: `[ -n "$PR" ] && node "$PR/scripts/lib/checkpoint.js" write {SESSION_DIR}/checkpoints resume-restore` (advisory; resume reads latest; empty `$PR` skips silently). If `{SESSION_DIR}/checkpoints/` exists, read latest via `latest` sub-command first; MISSING or empty checkpoints → fall back to existing artifact discovery, never error.

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
</instructions>
