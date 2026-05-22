---
name: team:resume
description: "Use when continuing previous work, picking up where left off, or resuming a paused session. Restores full context, contracts, and learnings."
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
