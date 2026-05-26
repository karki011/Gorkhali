---
name: team:resume
description: "Use when continuing previous work or picking up from where you stopped. Also use when user says 'resume', 'continue', 'pick up where we left off', 'I'm back', 'was in the middle of', 'stopped yesterday', 'continue from where we stopped', or 'restore context'. NOT if adding new scope — use team:start. Restores full context and plan."
---

> **Preamble Tier: T1** — loads `_shared.md` only (artifacts provide the rest)

# /team:resume "$ARGUMENTS"

Resume from a paused session by reading the state artifact.

<instructions>
1. **Detect ticket** from `$ARGUMENTS` (required — e.g., `/team:resume CP-41606`)

2. **Read state artifact**: `state/sessions/{TICKET}/pause-state.json`
   - If missing: list available sessions in `state/sessions/`, ask user to pick
   - If found: load and display summary

<staleness_check>
3. **Staleness check**: Compare `_meta.gitHead` to current `git rev-parse --short HEAD`
   - Match → continue
   - Mismatch → warn: "State saved at {old HEAD} but HEAD is now {new HEAD}."
     Show: `git log {old}..{new} --oneline`
     Ask: "Continue from saved state or start fresh?"
</staleness_check>

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
