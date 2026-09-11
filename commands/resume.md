---
name: resume
description: "Use when continuing PREVIOUS work from a paused or prior session - 'resume', 'pick up where we left off'. Restores the plan and progress. New scope -> start; approved plan already running -> just keep working."
argument-hint: "<task>"
user-invocable: true
---

# /resume "$ARGUMENTS"

Continue a session that was paused or interrupted.

<instructions>
1. Resolve the task id from `$ARGUMENTS`. Missing - use `lib/session.js`'s `activeSession` for the current one.
2. Read `plan.json` and `progress.json` for that task (via `lib/session.js`'s `readPlan` / `readProgress`).
   - No `plan.json` for that task - say no session was found, list the task ids under this repo's sessions folder (`_shared.md`'s Paths and Session Model), and ask which one to resume.
3. Show the last `progress.json` entry and the plan's recorded phase.
4. Re-present the same chat brief `start.md`'s **Phase 6: Plan Approval** shows, sourced from `plan.json`'s briefing fields, so the user re-confirms before anything continues: What, Problem, How, Evidence, Scope, Risks, Open questions, Approve?
5. On approval, continue from the recorded phase: `start.md`'s **Phase 7: Wiring Notification** and **Phase 8: Execution Dispatch**, or straight into dispatch if the plan was already past the gate when the session paused.
</instructions>

No staleness check against git HEAD, no portable handoff packet, no cost or ticket-provider calls here - those belong to `start.md`'s own phases, not to resuming one.
